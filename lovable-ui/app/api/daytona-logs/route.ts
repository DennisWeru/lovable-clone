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

    // Access the logs using the proper SDK filesystem API
    try {
      const filePath = req.nextUrl.searchParams.get("file") || "/home/daytona/worker.log";
      const action = req.nextUrl.searchParams.get("action") || "read"; // "read" or "list"
      
      if (action === "list") {
        const files = await sandbox.fs.listFiles(filePath);
        return NextResponse.json({ 
          success: true, 
          sandboxId, 
          path: filePath,
          files: files 
        });
      }
      
      // Read a file
      const fileBuffer = await sandbox.fs.downloadFile(filePath);
      return NextResponse.json({ 
        success: true, 
        sandboxId, 
        file: filePath,
        logs: fileBuffer.toString("utf-8")
      });
    } catch (fsErr: any) {
       return NextResponse.json({ 
         success: false, 
         error: "File operation failed.",
         details: fsErr.message 
       }, { status: 500 });
    }
    
  } catch (err: any) {
    console.error("[API] Log fetch failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
