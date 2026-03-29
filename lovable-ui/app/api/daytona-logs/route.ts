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

    // Access the logs
    try {
      // Just dumping the log file via standard cat since it's a Linux container
      const result = await sandbox.process.executeCommand("cat /home/daytona/worker.log", "/home/daytona");
      return NextResponse.json({ 
        success: true, 
        sandboxId, 
        logs: result || "Empty log file or no output yet." 
      });
    } catch (cmdErr: any) {
       return NextResponse.json({ 
         success: false, 
         error: "Failed to read logs or worker.log does not exist yet.",
         details: cmdErr.message 
       }, { status: 500 });
    }
    
  } catch (err: any) {
    console.error("[API] Log fetch failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
