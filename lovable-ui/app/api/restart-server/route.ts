import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in to restart server." },
        { status: 401 }
      );
    }

    const { sandboxId, projectId } = await req.json();

    if (!sandboxId) {
      return NextResponse.json(
        { error: "Sandbox ID is required" },
        { status: 400 }
      );
    }

    // Verify ownership
    if (projectId) {
      const supabaseAdmin = createAdminClient();
      const { data: project, error: projectError } = await supabaseAdmin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .single();

      if (projectError || !project || project.user_id !== user.id) {
        return NextResponse.json(
          { error: "Forbidden. You do not own this project." },
          { status: 403 }
        );
      }
    }

    if (!process.env.DAYTONA_API_KEY) {
      return NextResponse.json(
        { error: "Missing Daytona API key" },
        { status: 500 }
      );
    }

    console.log(`[Restart] Restarting server for sandbox ${sandboxId} for user ${user.id}`);

    // Dynamic import for Daytona SDK (ESM compat)
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

    // Find and wake the sandbox
    const list = await daytona.list();
    const sandboxItem = list.items.find((s: any) => s.id === sandboxId);

    if (!sandboxItem) {
      return NextResponse.json(
        { error: `Sandbox ${sandboxId} not found. It may have been deleted.` },
        { status: 404 }
      );
    }

    // Start sandbox if stopped
    if (sandboxItem.state === "stopped" || sandboxItem.state === "archived") {
      console.log(`[Restart] Sandbox is ${sandboxItem.state}, starting it...`);
      await sandboxItem.start();
      // Wait for it to be ready
      await new Promise(r => setTimeout(r, 3000));
      console.log(`[Restart] Sandbox started.`);
    }

    // Check if project files exist
    const checkRes = await sandboxItem.process.executeCommand(
      'test -d website-project && ls website-project/package.json 2>/dev/null && echo "OK" || echo "MISSING"'
    );
    const hasProject = checkRes.result?.includes("OK");

    if (!hasProject) {
      return NextResponse.json(
        { error: "Project files not found in sandbox. The sandbox may have been reset. Please regenerate." },
        { status: 410 }
      );
    }

    // Kill any existing server on port 3000
    console.log("[Restart] Killing existing processes on port 3000...");
    await sandboxItem.process.executeCommand(
      'fuser -k 3000/tcp 2>/dev/null || pkill -f "vite" 2>/dev/null || true'
    );
    await new Promise(r => setTimeout(r, 1000));

    // Start dev server with correct host binding
    console.log("[Restart] Starting Vite dev server...");
    await sandboxItem.process.executeCommand(
      'cd website-project && nohup npx vite --host 0.0.0.0 --port 3000 > /tmp/dev-server.log 2>&1 &'
    );

    // Wait for server to start
    await new Promise(r => setTimeout(r, 5000));

    // Verify server is listening
    const portCheck = await sandboxItem.process.executeCommand(
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "0"'
    );
    const httpCode = portCheck.result?.trim();
    const isRunning = httpCode === "200" || httpCode === "304";

    // Get fresh preview URL
    let previewUrl = "";
    try {
      const preview = await sandboxItem.getPreviewLink(3000);
      previewUrl = preview.url;
    } catch {
      try {
        const signed = await sandboxItem.getSignedPreviewUrl(3000, 7200);
        previewUrl = signed.url;
      } catch {
        previewUrl = `https://${sandboxId}.daytona.app`;
      }
    }

    // Update project with fresh preview URL
    if (projectId && previewUrl) {
      const supabaseAdmin = createAdminClient();
      await supabaseAdmin
        .from("projects")
        .update({ preview_url: previewUrl })
        .eq("id", projectId);
    }

    console.log(`[Restart] Done. Server running: ${isRunning}, Preview: ${previewUrl}`);

    return NextResponse.json({
      success: true,
      serverRunning: isRunning,
      httpCode,
      previewUrl,
    });

  } catch (error: any) {
    console.error("[Restart] Top-level Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}