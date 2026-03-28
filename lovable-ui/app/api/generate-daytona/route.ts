import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateWebsiteInDaytona } from "@/lib/generation/daytona";

export const maxDuration = 300;

const GENERATION_COST = 100;

export async function POST(req: NextRequest) {
  try {
    // 1. Basic Environment Check
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[API] Critical: Missing Supabase Environment Variables");
      return NextResponse.json(
        { error: "Server configuration error: Missing Supabase keys" },
        { status: 500 }
      );
    }

    if (!process.env.DAYTONA_API_KEY) {
      return NextResponse.json(
        { error: "Server configuration error: Missing Daytona API key" },
        { status: 500 }
      );
    }

    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("[API] Auth error or No user:", authError);
      return NextResponse.json(
        { error: "Unauthorized. Please log in to generate code." },
        { status: 401 }
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
      return NextResponse.json(
        { error: "Could not fetch user profile", details: profileError?.message },
        { status: 500 }
      );
    }

    if (profile.credits < GENERATION_COST) {
      return NextResponse.json(
        { error: `Insufficient credits. You need ${GENERATION_COST} credits to generate an app.` },
        { status: 403 }
      );
    }

    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { prompt, model, sandboxId: existingSandboxId, projectId } = body;
    
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    
    // Deduct credits early
    const { error: deductError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits - GENERATION_COST })
      .eq("id", user.id);

    if (deductError) {
      console.error("[API] Credit deduction failed:", deductError);
      return NextResponse.json(
        { error: "Failed to deduct credits securely. Please try again." },
        { status: 500 }
      );
    }

    // Create a record in projects table
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
        // Fetch conversation history
        let conversationHistory = "";
        if (existingSandboxId && projectId) {
          const { data: historyMsgs } = await supabaseAdmin
            .from("project_messages")
            .select("type, content, metadata")
            .eq("project_id", projectId)
            .in("type", ["user", "claude_message"])
            .order("created_at", { ascending: true })
            .limit(20);

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

        // Update completion status
        if (projectRecord) {
          await supabaseAdmin
            .from("projects")
            .update({
              sandbox_id: result.sandboxId,
              preview_url: result.previewUrl,
              status: "completed"
            })
            .eq("id", projectRecord.id);

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
    console.error("[API] Top-level Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}