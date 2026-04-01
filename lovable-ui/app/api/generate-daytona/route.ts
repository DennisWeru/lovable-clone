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
    const { prompt, model, sandboxId: existingSandboxId, projectId, initialHistory } = body;

    if (!prompt) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

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

    const webhookToken = crypto.randomUUID();

    // Credit Check
    const { data: profile } = await supabaseAdmin.from("profiles").select("credits").eq("id", userId).single();
    if (!profile || (profile.credits || 0) < 150) {
      return NextResponse.json({ error: "Insufficient credits (Min 150 needed)" }, { status: 403 });
    }

    // Deduct Activation Fee
    await supabaseAdmin.rpc("decrement_credits", { user_id: userId, amount: 100 });

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

    // Daytona Provisioning
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    let sandbox;
    let sandboxId = existingSandboxId;

    if (sandboxId) {
      const result = await daytona.list();
      sandbox = result.items.find((s: any) => s.id === sandboxId);
    }

    if (!sandbox) {
      sandbox = await daytona.create({
        public: false,
        image: "mcr.microsoft.com/playwright:v1.49.0-noble",
        resources: { cpu: 2, memory: 4, disk: 5 },
        autoStopInterval: 60
      });
      sandboxId = sandbox.id;
    }

    // Worker Script (OpenHands) - Read from standalone file
    const workerPath = path.join(process.cwd(), "app/api/generate-daytona/worker.mjs");
    const workerContent = fs.readFileSync(workerPath, "utf8");

    const remoteWorkerPath = "/home/daytona/generation-worker.mjs";
    await sandbox.fs.uploadFile(Buffer.from(workerContent), remoteWorkerPath);

    const host = req.headers.get("host") || "lovabee.vercel.app";
    const protocol = host.includes("localhost") ? "http" : "https";
    const webhookUrl = `${protocol}://${host}/api/webhooks/daytona-progress`;

    let previewUrl = `https://${sandboxId}.daytona.app`; 
    try {
      const preview = await sandbox.getPreviewLink(3000);
      previewUrl = preview.url;
    } catch (e) {}

    const envFileContent = Object.entries({
      GENERATION_PROMPT: prompt,
      GENERATION_MODEL: model || "google/gemini-3.1-flash-lite-preview",
      PROJECT_ID: projectRecord.id,
      WEBHOOK_TOKEN: webhookToken,
      WEBHOOK_URL: webhookUrl,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      SANDBOX_ID: sandboxId,
      PREVIEW_URL: previewUrl,
    }).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");

    await sandbox.fs.uploadFile(Buffer.from(envFileContent), "/home/daytona/worker-env.sh");

    const sessionId = `gen-${projectRecord.id.slice(0, 8)}`;
    try { await sandbox.process.createSession(sessionId); } catch (e) {}

    await sandbox.process.executeSessionCommand(sessionId, {
      command: `source /home/daytona/worker-env.sh && node ${remoteWorkerPath} > /home/daytona/worker.log 2>&1`,
      runAsync: true,
    });

    return NextResponse.json({ success: true, projectId: projectRecord.id, sandboxId });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
