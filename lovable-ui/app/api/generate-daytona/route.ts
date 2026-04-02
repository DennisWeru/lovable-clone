import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

export async function GET() {
  try {
    const { Daytona } = await import("@daytonaio/sdk");
    return NextResponse.json({
      status: "ok",
      hasDaytona: !!Daytona,
      nodeVersion: process.version,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  console.log("[API] --- Generation Request Start ---");
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, model, sandboxId: existingSandboxId, projectId, initialHistory, skipAgent, mode, force } = body;

    const isBackup = mode === "backup";
    if (!prompt && !isBackup) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

    const { Daytona } = await import("@daytonaio/sdk");
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;
    const supabaseAdmin = createAdminClient();

    if (!process.env.DAYTONA_API_KEY || !process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "API Keys missing" }, { status: 500 });
    }

    const isResume = !!projectId;
    const isSkipAgent = !!skipAgent;

    const webhookToken = crypto.randomUUID();

    // Credit Check
    const { data: profile } = await supabaseAdmin.from("profiles").select("credits").eq("id", userId).single();
    if (!isBackup && !force) {
      if (!profile || (profile.credits || 0) < 150) {
        return NextResponse.json({ error: "Insufficient credits (Min 150 needed)" }, { status: 403 });
      }
      // Deduct Activation Fee
      await supabaseAdmin.rpc("decrement_credits", { user_id: userId, amount: 100 });
    }

    // Project Record
    let projectRecord;
    if (projectId) {
      const { data } = await supabaseAdmin.from("projects").update({ webhook_token: webhookToken }).eq("id", projectId).select().single();
      projectRecord = data;
    } else {
      const { data } = await supabaseAdmin.from("projects").insert({
        name: prompt.split(" ").slice(0, 5).join(" "),
        prompt,
        model: model || "google/gemini-3.1-flash-lite-preview",
        user_id: userId,
        webhook_token: webhookToken,
        status: "pending"
      }).select().single();
      projectRecord = data;
    }

    if (!projectRecord) throw new Error("Failed to create or retrieve project record");
    
    // Save User Message to History if it doesn't exist and not skipping agent
    if (!isSkipAgent) {
      const { data: existing } = await supabaseAdmin
        .from("project_messages")
        .select("id")
        .eq("project_id", projectRecord.id)
        .eq("type", "user")
        .eq("content", prompt)
        .maybeSingle();

      if (!existing) {
        await supabaseAdmin.from("project_messages").insert({
          project_id: projectRecord.id,
          type: "user",
          content: prompt,
        });
      }
    }



    // Daytona Provisioning
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    let sandbox;
    let sandboxId = projectRecord.sandbox_id || existingSandboxId;

    if (sandboxId) {
      try {
        console.log(`[API] Attempting to retrieve existing sandbox: ${sandboxId}`);
        const result = await daytona.list();
        sandbox = result.items.find((s: any) => s.id === sandboxId);
        
        if (sandbox) {
          // If sandbox is found but not running, we might need to start it.
          // Note: The SDK 'list' output might not have status, but we can try to 'start' it if it's inactive.
          console.log(`[API] Found existing sandbox. Starting/Waking up...`);
          // Ensuring the sandbox is started. Most Daytona SDKs handle 'start' on an existing object.
          // If the SDK doesn't have .start(), we assume it's auto-managed by the system when we interact.
          try {
             if (typeof (sandbox as any).start === 'function') {
               await (sandbox as any).start();
             }
          } catch (e) {
             console.warn("[API] Sandbox start call failed (might already be running):", (e as Error).message);
          }
        }
      } catch (e) {
        console.warn(`[API] Failed to retrieve/start existing sandbox ${sandboxId}:`, (e as Error).message);
        sandbox = null;
      }
    }

    if (!sandbox) {
      console.log("[API] Creating brand new sandbox...");
      sandbox = await daytona.create({
        public: true,
        image: "mcr.microsoft.com/playwright:v1.49.0-noble",
        resources: { cpu: 2, memory: 4, disk: 5 },
        autoStopInterval: 60
      });
      sandboxId = sandbox.id;
      
      // Update the project record with the new sandbox ID
      await supabaseAdmin.from("projects").update({ sandbox_id: sandboxId }).eq("id", projectRecord.id);
    }

    // Worker Script (OpenHands) - Read from standalone file
    const workerPath = path.join(process.cwd(), "app/api/generate-daytona/worker.mjs");
    const workerContent = fs.readFileSync(workerPath, "utf8");

    const remoteWorkerPath = "/home/daytona/generation-worker.mjs";
    await sandbox.fs.uploadFile(Buffer.from(workerContent), remoteWorkerPath);

    // Upload Python SDK runner
    const runnerPath = path.join(process.cwd(), "app/api/generate-daytona/agent_runner.py");
    const runnerContent = fs.readFileSync(runnerPath, "utf8");
    await sandbox.fs.uploadFile(Buffer.from(runnerContent), "/home/daytona/agent_runner.py");

    const host = req.headers.get("host") || process.env.VERCEL_URL || "lovabee.vercel.app";
    const protocol = (host.includes("localhost") || host.includes("127.0.0.1")) ? "http" : "https";
    const webhookUrl = process.env.WEBHOOK_BASE_URL 
      ? `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`
      : `${protocol}://${host}/api/webhooks/daytona-progress`;

    console.log(`[API] Webhook URL configured as: ${webhookUrl}`);

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing in server environment");
    }

    let previewUrl = `https://${sandboxId}.daytona.app`; 
    try {
      const preview = await sandbox.getPreviewLink(3000);
      previewUrl = preview.url;
    } catch (e) {
      console.warn("[API] Failed to get official preview link, using fallback:", previewUrl);
    }

    // Update the project record with the initial preview URL
    await supabaseAdmin.from("projects").update({ preview_url: previewUrl }).eq("id", projectRecord.id);

    const envFileContent = Object.entries({
      GENERATION_PROMPT: prompt || "Manual Backup",
      MODE: mode || "full",
      GENERATION_MODEL: model || "google/gemini-3.1-flash-lite-preview",
      PROJECT_ID: projectRecord.id,
      WEBHOOK_TOKEN: webhookToken,
      WEBHOOK_URL: webhookUrl,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      SANDBOX_ID: sandboxId,
      PREVIEW_URL: previewUrl,
      OPENHANDS_SID: `sid-${projectRecord.id.slice(0, 8)}`,
      IS_RESUME: isResume ? "true" : "false",
      SKIP_AGENT: isSkipAgent ? "true" : "false",
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GAI_STRATEGY: "inet", // Force IPv4 to bypass DNS hangs
      PYTHONUNBUFFERED: "1",
      TEMPLATE_REPO_URL: "https://gitlab.com/weruDennis/reactvitetemplate.git",
      TEMPLATE_REPO_BRANCH: "main"
    }).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");

    await sandbox.fs.uploadFile(Buffer.from(envFileContent), "/home/daytona/worker-env.sh");

    const sessionId = `gen-${projectRecord.id.slice(0, 8)}`;

    // Cleanup previous session to avoid zombie workers (which would cause 401 token errors)
    try {
      console.log(`[API] Cleaning up existing session if any: ${sessionId}`);
      await sandbox.process.deleteSession(sessionId);
    } catch (e) {
      // Session likely doesn't exist or already closed
    }

    try { await sandbox.process.createSession(sessionId); } catch (e) {}

    await sandbox.process.executeSessionCommand(sessionId, {
      command: `source /home/daytona/worker-env.sh && node ${remoteWorkerPath} > /home/daytona/worker.log 2>&1`,
      runAsync: true,
    });

    return NextResponse.json({ 
      success: true, 
      projectId: projectRecord.id, 
      sandboxId,
      previewUrl 
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
