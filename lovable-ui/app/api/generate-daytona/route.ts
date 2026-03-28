import { NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateWebsiteInDaytona } from "@/lib/generation/daytona";

const GENERATION_COST = 100;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error("[API] Auth error:", authError);
    }

    if (!user) {
      console.error("[API] No user found in session");
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in to generate code." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[API] User authenticated:", user.id);

    // Use admin client to bypass RLS for profile check
    const supabaseAdmin = createAdminClient();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[API] Profile fetch error for user", user.id, ":", profileError);
      return new Response(
        JSON.stringify({ error: "Could not fetch user profile", details: profileError?.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (profile.credits < GENERATION_COST) {
      return new Response(
        JSON.stringify({ error: `Insufficient credits. You need ${GENERATION_COST} credits to generate an app.` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const { prompt, model, sandboxId: existingSandboxId, projectId } = await req.json();
    
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const isGemini = model?.startsWith("gemini");
    const isClaude = model?.startsWith("claude");

    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Daytona API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (isClaude && !process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Anthropic API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (isGemini && !process.env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Gemini API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[API] Starting Daytona generation for ${existingSandboxId || 'new sandbox'} using ${model}:`, prompt);

    // Deduct credits early using admin client
    const { error: deductError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits - GENERATION_COST })
      .eq("id", user.id);

    if (deductError) {
      return new Response(
        JSON.stringify({ error: "Failed to deduct credits securely. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create a record in projects table with 'pending' status using admin client to bypass RLS issues
    const { data: projectRecord, error: projectError } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: user.id,
        prompt: prompt,
        model: model || "gemini-2.5-flash",
        status: "pending",
        sandbox_id: existingSandboxId
      })
      .select()
      .single();

    if (projectError) {
      console.error("[API] Failed to create project record:", projectError);
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    // Start the async generation
    (async () => {
      try {
        // Fetch conversation history for follow-up prompts
        let conversationHistory = "";
        if (existingSandboxId && projectId) {
          const { data: historyMsgs } = await supabaseAdmin
            .from("project_messages")
            .select("type, content, metadata")
            .eq("project_id", projectId)
            .in("type", ["user", "claude_message"]) // skip tool noise
            .order("created_at", { ascending: true })
            .limit(20); // last 20 meaningful messages

          if (historyMsgs && historyMsgs.length > 0) {
            conversationHistory = historyMsgs
              .map((m) => {
                const role = m.type === "user" ? "User" : "Assistant";
                return `${role}: ${m.content ?? ""}`;
              })
              .join("\n");
          }
        }

        const collectedMessages: Array<{
          type: string;
          content?: string;
          metadata?: Record<string, any>;
        }> = [];

        const result = await generateWebsiteInDaytona({
          sandboxId: existingSandboxId,
          prompt,
          model: model || "gemini-2.5-flash",
          conversationHistory,
          onProgress: async (message) => {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "progress", message })}\n\n`));
          },
          onClaudeMessage: async (content) => {
            collectedMessages.push({ type: "claude_message", content });
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "claude_message", content })}\n\n`));
          },
          onToolUse: async (name, input) => {
            collectedMessages.push({ type: "tool_use", content: name, metadata: { name, input } });
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "tool_use", name, input })}\n\n`));
          },
          onError: async (code, message) => {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", code, message })}\n\n`));
          }
        });

        // Update the database with completion
        if (projectRecord) {
          await supabaseAdmin
            .from("projects")
            .update({
              sandbox_id: result.sandboxId,
              preview_url: result.previewUrl,
              status: "completed"
            })
            .eq("id", projectRecord.id);

          // Persist conversation messages
          const messagesToInsert = [
            { project_id: projectRecord.id, type: "user", content: prompt },
            ...collectedMessages.map((m) => ({
              project_id: projectRecord.id,
              type: m.type,
              content: m.content ?? null,
              metadata: m.metadata ?? null,
            })),
          ];
          await supabaseAdmin.from("project_messages").insert(messagesToInsert);
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: "complete", 
          sandboxId: result.sandboxId, 
          previewUrl: result.previewUrl 
        })}\n\n`));

        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during generation:", error);

        if (projectRecord) {
          await supabaseAdmin
            .from("projects")
            .update({ status: "failed" })
            .eq("id", projectRecord.id);
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`));
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await writer.close();
      }
    })();
    
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
    
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}