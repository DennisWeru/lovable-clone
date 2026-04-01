import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import crypto from "crypto";

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
        image: "mcr.microsoft.com/playwright:v1.45.0-jammy",
        resources: { cpu: 2, memory: 4 },
        autoStopInterval: 60
      });
      sandboxId = sandbox.id;
    }

    // Worker Script (OpenHands)
    const i = "import";
    const workerContent = String.raw`
${i} { execSync, spawn } from "child_process";
${i} * as fs from "fs";
${i} * as path from "path";

const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";
const PREVIEW_URL = process.env.PREVIEW_URL || "";

const FRIENDLY_MESSAGES = [
  "Analyzing your request and planning the architecture... 🐝",
  "Initializing OpenHands autonomous agent... 🚀",
  "Applying expert skills in React, Vite, and Tailwind... 🍯",
  "Optimizing performance and ensuring smooth transitions... 🌻",
  "The Lovabee agent is busy writing high-quality code..."
];

let lastUpdateAt = Date.now();
let currentFriendlyIndex = 0;

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  lastUpdateAt = Date.now();
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data })
    });
  } catch (e) { console.warn("[Worker] Update failed:", e.message); }
}

function startFriendlyRotation() {
  setInterval(async () => {
    if (Date.now() - lastUpdateAt > 20000) {
      const msg = FRIENDLY_MESSAGES[currentFriendlyIndex];
      currentFriendlyIndex = (currentFriendlyIndex + 1) % FRIENDLY_MESSAGES.length;
      await sendUpdate("progress", { message: "✨ " + msg });
    }
  }, 20000);
}

const projectDir = path.join(process.cwd(), "website-project");
if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

async function main() {
  try {
    startFriendlyRotation();
    await sendUpdate("progress", { message: "🚀 Preparing environment..." });

    // 1. Install uv & OpenHands
    try {
      execSync("curl -LsSf https://astral.sh/uv/install.sh | sh", { stdio: "inherit" });
      process.env.PATH = path.join(process.env.HOME || "/home/daytona", ".cargo/bin") + ":" + process.env.PATH;
      execSync("uv tool install openhands-ai", { stdio: "inherit" });
    } catch (e) {
      console.warn("[Worker] uv failed, using pip");
      execSync("pip install openhands-ai", { stdio: "inherit" });
    }

    // 2. Write Rules
    const rules = [
      "# Lovabee Agent Skills",
      "- Tech: React, Vite, Tailwind CSS",
      "- Style: Premium, modern aesthetics",
      "- Architecture: Feature-based structure",
      "- Port: 3000 (Required for preview)"
    ].join("\n");
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), rules);

    // 3. Run Agent
    await runOpenHands();

    // 4. Start Server
    await sendUpdate("progress", { message: "🔗 Launching preview..." });
    execSync('fuser -k 3000/tcp 2>/dev/null || pkill -f "vite" 2>/dev/null || true');
    execSync('cd ' + projectDir + ' && nohup npx vite --host 0.0.0.0 --port 3000 > /home/daytona/dev-server.log 2>&1 &');

    await sendUpdate("complete", { 
      message: "Ready! 🎉", 
      metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL, engine: "openhands" } 
    });
  } catch (err) {
    await sendUpdate("error", { message: "Failed: " + err.message });
    process.exit(1);
  }
}

async function runOpenHands() {
  const env = { ...process.env, LLM_API_KEY: OPENROUTER_API_KEY, LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_MODEL: "openrouter/" + MODEL };
  const args = [ "--headless", "-t", PROMPT ];

  return new Promise((resolve, reject) => {
    const cp = spawn("openhands", args, { env, cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
    cp.stdout.on("data", (data) => {
      if (data.toString().includes("action")) sendUpdate("progress", { message: "Agent acting..." });
    });
    cp.on("close", (code) => code === 0 ? resolve() : reject(new Error("Agent exit " + code)));
  });
}

main();
`;

    const workerPath = "/home/daytona/generation-worker.mjs";
    await sandbox.fs.uploadFile(Buffer.from(workerContent), workerPath);

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
      command: `source /home/daytona/worker-env.sh && node ${workerPath} > /home/daytona/worker.log 2>&1`,
      runAsync: true,
    });

    return NextResponse.json({ success: true, projectId: projectRecord.id, sandboxId });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
