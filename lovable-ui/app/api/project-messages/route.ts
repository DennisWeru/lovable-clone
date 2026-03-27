import { NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const projectId = req.nextUrl.searchParams.get("projectId");

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "projectId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createAdminClient();

    // Verify the project belongs to this user
    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();

    if (projectError || !project || project.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Project not found or access denied" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch messages in chronological order
    const { data: messages, error: msgError } = await supabaseAdmin
      .from("project_messages")
      .select("id, type, content, metadata, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("[project-messages] DB error:", msgError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch messages" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ messages: messages || [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[project-messages] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
