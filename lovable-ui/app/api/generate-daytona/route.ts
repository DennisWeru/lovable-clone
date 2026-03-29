import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60; 

export async function GET() {
  try {
    console.log("[API] GET Diagnostics starting...");
    const { Daytona } = await import("@daytonaio/sdk");
    console.log("[API] Daytona SDK imported successfully in GET");
    return NextResponse.json({
      status: "ok",
      hasDaytona: !!Daytona,
      nodeVersion: process.version,
      env: {
        hasDaytonaKey: !!process.env.DAYTONA_API_KEY,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      }
    });
  } catch (err: any) {
    console.error("[API] GET Diagnostics failed:", err.message);
    return NextResponse.json({ error: `GET Diagnostics failed: ${err.message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  console.log("[API] --- Generation Request Start (Dynamic Import Mode) ---");
  try {
    // 1. Inputs
    const body = await req.json().catch(() => ({}));
    const { prompt, model, sandboxId: existingSandboxId, projectId } = body;
    console.log("[API] Inputs received:", { prompt: prompt?.slice(0, 30), model, sandboxId: existingSandboxId, projectId });

    if (!prompt) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

    // 2. Dynamic Import Daytona (Fix for ERR_REQUIRE_ESM)
    console.log("[API] Importing Daytona SDK...");
    const { Daytona } = await import("@daytonaio/sdk");
    console.log("[API] Daytona SDK imported successfully");
    
    // 3. Auth & Environment
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authData?.user) {
      console.error("[API] Unauthorized generation attempt");
      return NextResponse.json({ error: "Unauthorized: Please log in to generate projects" }, { status: 401 });
    }
    
    const userId = authData.user.id;
    const supabaseAdmin = createAdminClient();

    if (!process.env.DAYTONA_API_KEY || !process.env.GEMINI_API_KEY) {
      console.error("[API] Missing API Keys");
      return NextResponse.json({ error: "Server Configuration Error: API Keys missing" }, { status: 500 });
    }

    const webhookToken = crypto.randomUUID();

    // 4. Database Project Record
    let projectRecord;
    if (projectId) {
      console.log("[API] Updating project:", projectId);
      // Verify ownership
      const { data: existing, error: findError } = await supabaseAdmin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .single();
        
      if (findError || !existing) throw new Error("Project not found");
      if (existing.user_id !== userId) throw new Error("Unauthorized: You do not own this project");

      const { data, error } = await supabaseAdmin
        .from("projects")
        .update({ webhook_token: webhookToken })
        .eq("id", projectId)
        .select()
        .single();
      if (error) throw new Error(`DB Update Error: ${error.message}`);
      projectRecord = data;
    } else {
      console.log("[API] Inserting new project...");
      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({
          name: prompt.split(" ").slice(0, 5).join(" "),
          prompt: prompt,
          model: model || "gemini-1.5-flash",
          user_id: userId,
          webhook_token: webhookToken,
          status: "pending"
        })
        .select()
        .single();
      if (error) {
        console.error("[API] DB Insert failed:", error);
        throw new Error(`DB Insert Error: ${error.message}. Ensure 'webhook_token' column exists.`);
      }
      projectRecord = data;
    }

    // 5. Daytona Provisioning
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    let sandbox;
    let sandboxId = existingSandboxId;

    try {
      if (sandboxId) {
        console.log("[API] Finding sandbox:", sandboxId);
        const sandboxes = await daytona.list();
        sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      }
      
      if (!sandbox) {
        console.log("[API] Creating sandbox...");
        sandbox = await daytona.create({ 
          public: true, 
          image: "node:20"
        });
        sandboxId = sandbox.id;
        console.log("[API] Sandbox created:", sandboxId);
      }
    } catch (e: any) {
      console.error("[API] Daytona error:", e);
      throw new Error(`Daytona sandbox failed: ${e.message}`);
    }

    // 6. Worker Payload (Bundled)
    const workerContent = `
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

console.log("[Worker] Bootstrapping...");

// Create a minimal package.json for ESM support
if (!fs.existsSync("package.json")) {
  fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
}

// Install dependencies BEFORE importing them
try { 
  console.log("[Worker] Installing @google/generative-ai...");
  execSync("npm install @google/generative-ai", { stdio: "inherit", cwd: "/home/daytona" }); 
  console.log("[Worker] Install complete.");
} catch (e) { 
  console.error("[Worker] Failed to install dependencies:", e); 
  process.exit(1);
}

const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "gemini-1.5-flash";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data })
    });
  } catch (e) { console.error("[Worker] sendUpdate failed:", e); }
}

async function run() {
  // Give frontend a moment to subscribe to Realtime
  await new Promise(r => setTimeout(r, 2000));
  await sendUpdate("progress", { message: "🚀 Worker started..." });
  try {
    // Dynamic import — only after npm install has completed
    const { GoogleGenerativeAI } = await import("@google/generative-ai");

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const aiModel = genAI.getGenerativeModel({ model: MODEL });
    const projectDir = path.join(process.cwd(), "website-project");
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

    await sendUpdate("progress", { message: "🤖 Generating code with AI..." });
    const result = await aiModel.generateContent(PROMPT);
    const text = result.response.text();
    const tripleBacktick = String.fromCharCode(96, 96, 96);
    const cleanJson = text.split(tripleBacktick + "json").pop().split(tripleBacktick).shift().trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed.files) {
      await sendUpdate("progress", { message: "📁 Writing " + parsed.files.length + " files..." });
      for (const file of parsed.files) {
        const filePath = path.join(projectDir, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, file.content);
        await sendUpdate("tool_use", { name: "WriteFile", input: { path: file.path } });
      }
    }
    await sendUpdate("complete", { message: "Success!", metadata: { sandboxId: SANDBOX_ID, previewUrl: "https://" + SANDBOX_ID + ".daytona.app" } });
  } catch (e) {
    console.error("[Worker] Error:", e);
    await sendUpdate("error", { message: e.message });
  }
}
run();
`;

    // 7. Upload files and execute in Sandbox using proper SDK APIs
    // Worker MUST live in /home/daytona/ alongside node_modules (Node resolves relative to script location)
    const workerPath = "/home/daytona/generation-worker.mjs";
    
    // Upload the worker file directly as a Buffer
    console.log("[API] Uploading worker script...");
    await sandbox.fs.uploadFile(Buffer.from(workerContent), workerPath);

    // Force HTTPS on Vercel unless explicitly localhost
    let protocol = "https";
    const host = req.headers.get("host") || "lovable-clone.vercel.app";
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      protocol = "http";
    }
    
    let webhookUrl = `${protocol}://${host}/api/webhooks/daytona-progress`;
    if (process.env.WEBHOOK_BASE_URL) webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`;

    console.log("[API] Webhook URL set to:", webhookUrl);

    // Write env vars to a file since SessionExecuteRequest doesn't support env
    const envFileContent = Object.entries({
       GENERATION_PROMPT: prompt,
       GENERATION_MODEL: model || "gemini-1.5-flash",
       PROJECT_ID: projectRecord.id,
       WEBHOOK_TOKEN: webhookToken,
       WEBHOOK_URL: webhookUrl,
       GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
       SANDBOX_ID: sandboxId,
    }).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");
    
    console.log("[API] Uploading .env file...");
    await sandbox.fs.uploadFile(
      Buffer.from(envFileContent),
      "/home/daytona/worker-env.sh"
    );

    // Use Daytona Sessions API for reliable background execution
    const sessionId = `gen-${projectRecord.id.slice(0, 8)}`;
    console.log("[API] Creating session:", sessionId);
    await sandbox.process.createSession(sessionId);
    
    // Execute the worker asynchronously in the session (source env, then run node)
    console.log("[API] Launching worker in session...");
    const sessionResult = await sandbox.process.executeSessionCommand(sessionId, {
      command: `source /home/daytona/worker-env.sh && cd /home/daytona && node ${workerPath} > /home/daytona/worker.log 2>&1`,
      runAsync: true,
    });
    console.log("[API] Session command launched, cmdId:", sessionResult.cmdId);

    console.log("[API] Hand-off success.");
    return NextResponse.json({
       success: true,
       projectId: projectRecord.id,
       sandboxId: sandboxId
    });

  } catch (err: any) {
    console.error("[API] Fatal error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
