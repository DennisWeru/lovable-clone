import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, token, type, message, content, metadata } = body;

    if (!projectId || !token) {
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Webhook] Top-level error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
