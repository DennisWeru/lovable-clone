import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, model } = body;

    if (!prompt) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;
    const supabaseAdmin = createAdminClient();

    const { data: projectRecord, error: insertError } = await supabaseAdmin
      .from("projects")
      .insert({
        name: prompt.split(" ").slice(0, 5).join(" "),
        prompt,
        model: model || "google/gemini-3.1-flash-lite-preview",
        user_id: userId,
        status: "pending"
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, projectId: projectRecord.id });
  } catch (err: any) {
    console.error("[API Projects] Error creating project:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
