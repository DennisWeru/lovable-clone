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

    // 1. Verify token
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("webhook_token", token)
      .single();

    if (projectError || !project) {
      console.error("[Webhook] Unauthorized or invalid project:", projectId);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Insert into project_messages
    // 'message' becomes 'content' for progress type
    const finalContent = content || message;
    
    const { error: insertError } = await supabase
      .from("project_messages")
      .insert({
        project_id: projectId,
        type: type, // 'progress', 'claude_message', 'tool_use', 'error', 'complete'
        content: finalContent,
        metadata: metadata || null
      });

    if (insertError) {
      console.error("[Webhook] Insert error:", insertError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 3. Update project status and preview_url if needed
    if (type === "complete") {
      console.log("[Webhook] Completing project:", projectId);
      
      // Update basic project info
      const { data: updatedProject, error: updateError } = await supabase
        .from("projects")
        .update({
          status: "completed",
          preview_url: metadata?.previewUrl || null,
          sandbox_id: metadata?.sandboxId || null
        })
        .eq("id", projectId)
        .select("user_id")
        .single();
      
      if (updateError) console.error("[Webhook] Project update error:", updateError);

      // --- DYNAMIC BILLING LOGIC ---
      if (metadata?.genId && updatedProject?.user_id) {
        try {
          console.log(`[Billing] Starting billing for ${metadata.genId} (User: ${updatedProject.user_id})`);
          
          // Wait for OpenRouter to finalize internal billing stats
          await new Promise(r => setTimeout(r, 2000));
          
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          const resp = await fetch(`https://openrouter.ai/api/v1/generation?id=${metadata.genId}`, {
            headers: { "Authorization": `Bearer ${openRouterKey}` }
          });
          
          if (resp.ok) {
            const billData = await resp.json();
            const rawCost = billData.data?.native_tokens_prompt_total_cost || billData.data?.total_cost || 0;
            
            // 1 Credit = $0.0001 USD
            // OpenRouter 'total_cost' is usually in USD.
            const costInCredits = Math.ceil(Number(rawCost) * 10000);
            
            console.log(`[Billing] Generation ${metadata.genId} cost $${rawCost} -> ${costInCredits} credits`);
            
            if (costInCredits > 0) {
              // 1. Save to project
              await supabase
                .from("projects")
                .update({ credits_used: costInCredits })
                .eq("id", projectId);

              // 2. Deduct from profile using atomic RPC
              const { data: success, error: rpcError } = await supabase.rpc("decrement_credits", {
                user_id: updatedProject.user_id,
                amount: costInCredits
              });
              
              if (rpcError || !success) {
                console.error(`[Billing] Credit deduction failed for user ${updatedProject.user_id}:`, rpcError);
              } else {
                console.log(`[Billing] Deducted ${costInCredits} credits from user ${updatedProject.user_id}`);
              }
            }
          } else {
            console.error(`[Billing] Failed to fetch cost from OpenRouter: ${resp.status}`);
          }
        } catch (billingErr) {
          console.error("[Webhook] Billing failure:", billingErr);
        }
      }
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
