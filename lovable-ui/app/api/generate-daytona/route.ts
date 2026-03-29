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
    const workerContent = String.raw`
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Global error tracking
process.on("uncaughtException", (err) => {
  console.error("[Worker] FATAL Uncaught Exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[Worker] FATAL Unhandled Rejection:", err);
  process.exit(1);
});

console.log("[Worker] Agent process started.");

async function main() {
  try {
    console.log("[Worker] Bootstrapping environment...");
    if (!fs.existsSync("package.json")) {
      fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
    }

    // Install @google/generative-ai if not present
    if (!fs.existsSync("./node_modules/@google/generative-ai")) {
      console.log("[Worker] Installing @google/generative-ai (this may take a few seconds)...");
      try {
        const out = execSync("npm install @google/generative-ai", { encoding: "utf8" });
        console.log("[Worker] npm install success:", out);
      } catch (npmErr) {
        console.error("[Worker] npm install failed:", npmErr.message);
        // Continue anyway in case it's actually there
      }
    } else {
      console.log("[Worker] @google/generative-ai already present.");
    }

    // Now run the actual logic
    await runAgent();
    console.log("[Worker] Agent run complete.");
  } catch (err) {
    console.error("[Worker] Fatal error in main loop:", err);
    process.exit(1);
  }
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
  } catch (e) { console.error("[Worker] sendUpdate failed:", type, e.message); }
}

function parseResponse(text) {
  const tripleBacktick = String.fromCharCode(96, 96, 96);
  try { return JSON.parse(text); } catch (e) {}
  const fence = text.split(tripleBacktick + "json")[1] || text.split(tripleBacktick)[1];
  if (fence) {
    try { return JSON.parse(fence.split(tripleBacktick)[0].trim()); } catch (e) {}
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {}
  }
  return null;
}

async function runAgent() {
  console.log("[Worker] runAgent() starting...");
  await new Promise(r => setTimeout(r, 2000)); // Delay for stream stability
  await sendUpdate("progress", { message: "Agent active in sandbox..." });

  console.log("[Worker] Importing gen-ai SDK...");
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const aiModel = genAI.getGenerativeModel({ 
    model: MODEL,
    generationConfig: { responseMimeType: "application/json" }
  });

  const projectDir = path.join(process.cwd(), "website-project");
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  const PREVIEW_URL = process.env.PREVIEW_URL || ("https://" + SANDBOX_ID + ".daytona.app");

  let attempts = 0;
  const maxAttempts = 3;
  let lastError = null;

  const baseSystemPrompt = [
    "You are a Senior Autonomous Developer Agent. Build a complete website based on the user request.",
    "Respond ONLY with a JSON object: { \"files\": [ { \"path\": \"string\", \"content\": \"string\" } ] }",
    "RULES:",
    "- Escape all newlines and quotes correctly.",
    "- Include all necessary files (index.html, styles, scripts, package.json if needed).",
    "- Use modern, responsive design.",
  ].join("\n");

  while (attempts < maxAttempts) {
    attempts++;
    console.log("[Worker] Generation attempt:", attempts);
    await sendUpdate("progress", { 
      message: attempts === 1 ? "Generating initial code..." : "[Agent] Self-healing attempt " + (attempts - 1) + "..." 
    });

    const currentPrompt = lastError 
      ? "\nYour previous response failed validation with this error: " + lastError + ". Please provide the FULL fixed JSON."
      : "User Request: " + PROMPT;

    try {
      console.log("[Worker] Calling AI SDK...");
      const result = await aiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: baseSystemPrompt + "\n\n" + currentPrompt }] }],
      });
      console.log("[Worker] AI response received.");
      const text = result.response.text();
      const parsed = parseResponse(text);

      if (!parsed || !parsed.files) throw new Error("Could not extract valid files array from response.");

      console.log("[Worker] Parsed response with", parsed.files.length, "files.");
      await sendUpdate("progress", { message: "Writing " + parsed.files.length + " files..." });
      for (const file of parsed.files) {
        const filePath = path.join(projectDir, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, file.content);
        await sendUpdate("tool_use", { name: "WriteFile", input: { path: file.path } });
      }

      const pkgPath = path.join(projectDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        console.log("[Worker] package.json detected, running install...");
        await sendUpdate("progress", { message: "[Agent] Installing generated dependencies..." });
        try {
          execSync("npm install", { cwd: projectDir, encoding: "utf8" });
          console.log("[Worker] npm install success in website-project.");
          await sendUpdate("progress", { message: "[Agent] Dependencies installed successfully." });
        } catch (installErr) {
          console.error("[Agent] Dependency install failed:", installErr.message);
        }
      }

      console.log("[Worker] Generation successful. Starting server...");
      await sendUpdate("progress", { message: "[Agent] Starting preview server..." });

      // Identify start command
      let startCmd = "npx serve -s . -p 3000";
      if (fs.existsSync(path.join(projectDir, "package.json"))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
        if (pkg.scripts?.dev) startCmd = "npm run dev -- --port 3000";
        else if (pkg.scripts?.start) startCmd = "npm start -- --port 3000";
      }

      // Start server in background
      try {
        const { spawn } = await import("child_process");
        const serverProcess = spawn("sh", ["-c", "nohup " + startCmd + " > ../server.log 2>&1 &"], {
          cwd: projectDir,
          detached: true,
          stdio: "ignore"
        });
        serverProcess.unref();
        console.log("[Worker] Server launched with command:", startCmd);
      } catch (e) {
        console.error("[Worker] Failed to launch server process:", e.message);
      }

      // Wait for port 3000 to be open
      await sendUpdate("progress", { message: "[Agent] Waiting for server to be ready..." });
      await new Promise(r => setTimeout(r, 5000));

      console.log("[Worker] Sending completion update.");
      await sendUpdate("complete", { 
        message: "Project built and verified!", 
        metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL } 
      });
      return; 
    } catch (e) {
      console.error("[Agent] Exception during generation:", e.message);
      lastError = e.message;
      if (attempts === maxAttempts) {
        await sendUpdate("error", { message: "Autonomous generation failed after " + maxAttempts + " attempts: " + e.message });
        return;
      }
    }
  }
}

main();
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
    
    let webhookUrl = `${ protocol }://${host}/api/webhooks/daytona-progress`;
if (process.env.WEBHOOK_BASE_URL) webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`;

console.log("[API] Webhook URL set to:", webhookUrl);

// Get actual preview link from Daytona SDK
console.log("[API] Getting preview link for port 3000...");
let previewUrl = `https://${sandboxId}.daytona.app`; // Fallback
try {
  const preview = await sandbox.getPreviewLink(3000);
  previewUrl = preview.url;
} catch (e) {
  console.warn("[API] Could not get preview link via SDK, using fallback");
}

// Write env vars to a file since SessionExecuteRequest doesn't support env
const envFileContent = Object.entries({
  GENERATION_PROMPT: prompt,
  GENERATION_MODEL: model || "gemini-1.5-flash",
  PROJECT_ID: projectRecord.id,
  WEBHOOK_TOKEN: webhookToken,
  WEBHOOK_URL: webhookUrl,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  SANDBOX_ID: sandboxId,
  PREVIEW_URL: previewUrl,
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
