import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const sandboxId = req.nextUrl.searchParams.get("sandboxId");
    if (!sandboxId) {
      return NextResponse.json({ error: "No sandboxId provided" }, { status: 400 });
    }

    // Auth Check
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    
    // Find the sandbox
    const sandboxes = await daytona.list();
    const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    
    if (!sandbox) {
      return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
    }

    // Access the logs or run a custom command
    try {
      const cmdToRun = req.nextUrl.searchParams.get("cmd") || "cat /home/daytona/worker.log";
      const result = await sandbox.process.executeCommand(cmdToRun, "/home/daytona");
      return NextResponse.json({ 
        success: true, 
        sandboxId, 
        cmd: cmdToRun,
        result: result 
      });
    } catch (cmdErr: any) {
       return NextResponse.json({ 
         success: false, 
         error: "Command execution failed.",
         details: cmdErr.message 
       }, { status: 500 });
    }
    
  } catch (err: any) {
    console.error("[API] Log fetch failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
