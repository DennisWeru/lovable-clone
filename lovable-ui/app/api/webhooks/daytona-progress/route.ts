import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, token, type, message, content, metadata } = body;

    console.log(`[Webhook] Received ${type} update for project ${projectId}`);
    
    if (!projectId || !token) {
      console.warn("[Webhook] Missing projectId or token in payload");
      return NextResponse.json({ error: "Missing projectId or token" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Verify token and get user_id
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, user_id, credits_used, preview_url, sandbox_id")
      .eq("id", projectId)
      .eq("webhook_token", token)
      .single();

    if (projectError || !project) {
      console.error("[Webhook] Unauthorized or invalid project:", projectId);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = project.user_id;

    // 2. Billing Logic (Idempotent per genId)
    let billedMetadata = metadata || {};
    if (metadata?.genId && userId) {
      try {
        // Check if this generation was already billed
        const { data: existingBilled } = await supabase
          .from("project_messages")
          .select("id")
          .eq("project_id", projectId)
          .contains("metadata", { genId: metadata.genId, billed: true })
          .limit(1);

        if (existingBilled && existingBilled.length > 0) {
          console.log(`[Billing] Skipping already billed generation: ${metadata.genId}`);
        } else {
          console.log(`[Billing] Processing billing for turn: ${metadata.genId} (User: ${userId})`);
          
          let rawCost = 0;
          let attempts = 0;
          const maxAttempts = 3;
          const openRouterKey = process.env.OPENROUTER_API_KEY;

          while (attempts < maxAttempts) {
            attempts++;
            // Exponential backoff: 2s, 4s, 8s
            await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempts - 1)));
            
            const resp = await fetch(`https://openrouter.ai/api/v1/generation?id=${metadata.genId}`, {
              headers: { "Authorization": `Bearer ${openRouterKey}` }
            });
            
            if (resp.ok) {
              const billData = await resp.json();
              rawCost = billData.data?.total_cost || 0;
              // If we have a cost, break. Otherwise retry.
              if (rawCost > 0) break;
              console.log(`[Billing] Cost for ${metadata.genId} is still 0, retrying... (${attempts}/${maxAttempts})`);
            } else {
              console.warn(`[Billing] OpenRouter fetch failed: ${resp.status}`);
            }
          }

          // If cost is still 0 but we have usage, use a conservative estimate
          if (rawCost === 0 && metadata.usage) {
            const { prompt_tokens = 0, completion_tokens = 0 } = metadata.usage;
            // conservative estimate: $1 / 1M tokens ($0.000001 per token)
            rawCost = (prompt_tokens + completion_tokens) * 0.000001;
            console.log(`[Billing] Using conservative token estimate for ${metadata.genId}: $${rawCost}`);
          }

          const costInCredits = Math.ceil(Number(rawCost) * 10000);
          
          if (costInCredits > 0) {
            // 1. Update project total (Atomic increment)
            await supabase
              .from("projects")
              .update({ credits_used: (project.credits_used || 0) + costInCredits })
              .eq("id", projectId);

            // 2. Deduct from profile using atomic RPC
            const { data: success, error: rpcError } = await supabase.rpc("decrement_credits", {
              user_id: userId,
              amount: costInCredits
            });
            
            if (rpcError || !success) {
              console.error(`[Billing] Credit deduction failed for user ${userId}:`, rpcError);
            } else {
              console.log(`[Billing] Deducted ${costInCredits} credits from user ${userId}`);
              // Mark as billed in metadata for this message
              billedMetadata = { ...billedMetadata, billed: true, billed_amount: costInCredits };
            }
          } else {
            console.warn(`[Billing] Final cost for ${metadata.genId} is 0. Skipping.`);
          }
        }
      } catch (billingErr) {
        console.error("[Webhook] Billing execution failure:", billingErr);
      }
    }

    // 3. Insert into project_messages
    const finalContent = content || message;
    const { error: insertError } = await supabase
      .from("project_messages")
      .insert({
        project_id: projectId,
        type: type,
        content: finalContent,
        metadata: billedMetadata
      });

    if (insertError) {
      console.error("[Webhook] Insert error:", insertError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 4. Update project status and preview_url if needed
    if (type === "complete") {
      console.log("[Webhook] Completing project:", projectId);
      await supabase
        .from("projects")
        .update({
          status: "completed",
          preview_url: metadata?.previewUrl || project.preview_url,
          sandbox_id: metadata?.sandboxId || project.sandbox_id
        })
        .eq("id", projectId);
    } else if (type === "error") {
      console.error("[Webhook] Project error:", projectId, finalContent);
      await supabase
        .from("projects")
        .update({ status: "error" })
        .eq("id", projectId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Webhook] Top-level error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
