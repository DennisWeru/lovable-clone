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
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
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

    if (!process.env.DAYTONA_API_KEY || !process.env.OPENROUTER_API_KEY) {
      console.error("[API] Missing API Keys");
      return NextResponse.json({ error: "Server Configuration Error: API Keys missing" }, { status: 500 });
    }

    const webhookToken = crypto.randomUUID();

    // 4. Pre-flight Credit Check
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (!profile || (profile.credits || 0) < 50) {
      return NextResponse.json({ error: "Insufficient credits: Please top up to continue generation." }, { status: 403 });
    }

    // 5. Database Project Record
    let projectRecord;
    type LLMMessage = {
      role: "user" | "assistant" | "system" | "tool";
      content?: string;
      tool_calls?: any[];
      tool_call_id?: string;
      name?: string;
    };
    let initialHistory: LLMMessage[] = [];

    if (projectId) {
      console.log("[API] Updating existing project:", projectId);
      // Verify ownership
      const { data: existing, error: findError } = await supabaseAdmin
        .from("projects")
        .select("user_id, prompt")
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

      // FETCH HISTORY for existing project
      console.log("[API] Fetching history for project resume...");
      const { data: historyMsgs, error: histError } = await supabaseAdmin
        .from("project_messages")
        .select("type, content, metadata")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      
      if (!histError && historyMsgs && historyMsgs.length > 0) {
        // Map DB messages to LLM format
        initialHistory = (historyMsgs.map(m => {
          if (m.type === "user") return { role: "user", content: m.content } as LLMMessage;
          if (m.type === "claude_message") return { role: "assistant", content: m.content || "", tool_calls: m.metadata?.tool_calls } as LLMMessage;
          if (m.type === "tool_result") return { role: "tool", tool_call_id: m.metadata?.tool_call_id, name: m.metadata?.name, content: m.content } as LLMMessage;
          return null;
        }).filter(Boolean) as LLMMessage[]);
        console.log(`[API] Loaded ${initialHistory.length} history messages`);
      }
    } else {
      console.log("[API] Inserting new project...");
      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({
          name: prompt.split(" ").slice(0, 5).join(" "),
          prompt: prompt,
          model: model || "google/gemini-3.1-flash-lite-preview",
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
        const result = await daytona.list();
        sandbox = result.items.find((s: any) => s.id === sandboxId);
      }

      if (!sandbox) {
        console.log("[API] Creating sandbox (2 CPU / 4GB RAM, 60min auto-stop)...");
        sandbox = await daytona.create({
          public: false,
          image: "mcr.microsoft.com/playwright:v1.45.0-jammy",
          resources: { cpu: 2, memory: 4 },
          autoStopInterval: 60
        });
        sandboxId = sandbox.id;
        console.log("[API] Sandbox created:", sandboxId);
      }
    } catch (e: any) {
      console.error("[API] Daytona error:", e);
      throw new Error(`Daytona sandbox failed: ${e.message}`);
    }

    // 6. Worker Payload (Claude Code CLI Bootstrap)
    // @ts-ignore
    const i = "import";
    const workerContent = String.raw`
${i} { execSync, spawn } from "child_process";
${i} * as fs from "fs";
${i} * as path from "path";

// Global error tracking
process.on("uncaughtException", (err) => {
  console.error("[Worker] FATAL Uncaught Exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[Worker] FATAL Unhandled Rejection:", err);
  process.exit(1);
});

console.log("[Worker] Agent process started (Claude Code Mode).");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "anthropic/claude-3-5-sonnet-latest";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";
const PREVIEW_URL = process.env.PREVIEW_URL || ("https://" + SANDBOX_ID + ".daytona.app");
const SITE_URL = process.env.SITE_URL || "https://lovable-clone.vercel.app";

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

const projectDir = path.join(process.cwd(), "website-project");
if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

async function main() {
  try {
    await sendUpdate("progress", { message: "🚀 Bootstrapping Claude Code agent environment..." });
    console.log("[Worker] Bootstrapping environment...");

    // 1. Ensure basic package.json for the sandbox root
    if (!fs.existsSync("package.json")) {
      fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
    }

    // 2. Install Claude Code CLI globally if not present
    try {
      console.log("[Worker] Checking for Claude CLI...");
      execSync("claude --version", { stdio: "ignore" });
    } catch (e) {
      await sendUpdate("progress", { message: "📦 Installing @anthropic-ai/claude-code..." });
      console.log("[Worker] Installing Claude CLI globally...");
      const user = execSync("whoami", { encoding: "utf8" }).trim();
      const npmCmd = (user === "root" || user === "daytona") ? "npm install -g @anthropic-ai/claude-code" : "sudo npm install -g @anthropic-ai/claude-code";
      execSync(npmCmd, { stdio: "inherit", timeout: 120000 });
    }

    // 3. Create CLAUDE.md for project context
    const rules = [
      "# Project Rules",
      "- Environment: Node v20.15.0",
      "- Preferred Stack: React, Vite 5, Tailwind CSS.",
      "- Commands: Use 'npm' for all tasks.",
      "- Preview: Websites must run on port 3000.",
      "- Host: Use 'npx vite --host 0.0.0.0 --port 3000' to start the dev server (essential for proxy access).",
      "- Persistence: Always install dependencies before starting the server.",
      "- Visuals: Aim for premium, modern aesthetics (glassmorphism, vibrant gradients)."
    ].join("\n");
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), rules);

    // 4. Create a binary-free screenshot snapshot script for Claude to call
    const snapshotScript = [
      "(async () => {",
      "  const p = 'play' + 'wright';",
      "  const { chromium } = await import(/* webpackIgnore: true */ p);",
      "  const fs = await import('fs');",
      "",
      "  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });",
      "  const page = await browser.newPage();",
      "  try {",
      "    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });",
      "    const buffer = await page.screenshot();",
      "    fs.writeFileSync('/home/daytona/latest-screenshot.png', buffer);",
      "    console.log('Screenshot saved to /home/daytona/latest-screenshot.png.');",
      "  } catch (err) {",
      "    console.error('Screenshot failed:', err);",
      "    process.exit(1);",
      "  } finally {",
      "    await browser.close();",
      "  }",
      "})();"
    ].join("\n");
    fs.writeFileSync("/home/daytona/snapshot.mjs", snapshotScript);

    // 5. Execute Claude Code Agent
    await runClaude();

    console.log("[Worker] Claude Code run complete.");
  } catch (err) {
    console.error("[Worker] Fatal error in main loop:", err);
    await sendUpdate("error", { 
      message: "Fatal: " + (err.message || "Unknown error"), 
      metadata: { stack: err.stack }
    });
    process.exit(1);
  }
}

async function runClaude() {
  await sendUpdate("progress", { message: "🤖 Claude Code Agent is thinking..." });
  
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY: "", // Force usage of OpenRouter via base URL
    CLAUDE_MODEL: MODEL    // Pass the selected model to Claude Code
  };

  // Construct the command
  // -p: prompt (non-interactive mode)
  // --allowedTools: pre-approve crucial tools for autonomous work
  const args = [
    "-p", PROMPT,
    "--allowedTools", "Read,Edit,Bash",
    "--output-format", "text"
  ];

  console.log("[Worker] Spawning: claude", args.join(" "));
  
  const cp = spawn("claude", args, { 
    env, 
    cwd: projectDir,
    shell: true // Required for global command and npx resolution
  });

  // Track if we've seen any output to handle silence
  let hasOutput = false;

  cp.stdout.on("data", (data) => {
    hasOutput = true;
    const text = data.toString();
    console.log("[Claude STDOUT]:", text);
    // Send raw output as progress updates to the UI console
    sendUpdate("progress", { message: text });
  });

  cp.stderr.on("data", (data) => {
    const errText = data.toString();
    console.warn("[Claude STDERR]:", errText);
    if (!errText.includes("warning") && !errText.includes("Deprecation")) {
       sendUpdate("progress", { message: "⚠️ " + errText });
    }
  });

  return new Promise((resolve, reject) => {
    cp.on("close", (code) => {
      if (code === 0) {
        console.log("[Worker] Claude finished successfully.");
        sendUpdate("complete", { 
          message: "Project build complete! Claude has finished the task.", 
          metadata: { 
            sandboxId: SANDBOX_ID, 
            previewUrl: PREVIEW_URL,
            engine: "claude-code"
          } 
        });
        resolve();
      } else {
        const errorMsg = "Claude exited with code " + code;
        console.error("[Worker]", errorMsg);
        reject(new Error(errorMsg));
      }
    });

    cp.on("error", (err) => {
      console.error("[Worker] Process error:", err);
      reject(err);
    });
  });
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
    
    let webhookUrl = process.env.WEBHOOK_BASE_URL 
      ? `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`
      : `${protocol}://${host}/api/webhooks/daytona-progress`;

console.log("[API] Webhook URL set to:", webhookUrl);

// Get stable preview link from Daytona SDK (non-expiring, unlike signed URLs)
console.log("[API] Getting preview link for port 3000...");
let previewUrl = `https://${sandboxId}.daytona.app`; // Fallback
try {
  const preview = await sandbox.getPreviewLink(3000);
  previewUrl = preview.url;
  console.log("[API] Preview URL obtained:", previewUrl);
} catch (e: any) {
  console.warn("[API] Could not get preview link, trying signed URL as fallback:", e.message);
  try {
    // 7200 seconds = 2 hour expiry as fallback
    const signedPreview = await sandbox.getSignedPreviewUrl(3000, 7200);
    previewUrl = signedPreview.url;
    console.log("[API] Signed preview URL obtained:", previewUrl.slice(0, 50) + "...");
  } catch (err) {
    console.warn("[API] All preview link methods failed, using raw fallback");
  }
}

// Write env vars to a file since SessionExecuteRequest doesn't support env
const envFileContent = Object.entries({
  GENERATION_PROMPT: prompt,
  GENERATION_MODEL: model || "openai/gpt-4o-2024-08-06",
  PROJECT_ID: projectRecord.id,
  WEBHOOK_TOKEN: webhookToken,
  WEBHOOK_URL: webhookUrl,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY || "",
  SANDBOX_ID: sandboxId,
  PREVIEW_URL: previewUrl,
  SITE_URL: `${protocol}://${host}`,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  INITIAL_HISTORY: JSON.stringify(initialHistory)
}).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");

console.log("[API] Uploading .env file...");
await sandbox.fs.uploadFile(
  Buffer.from(envFileContent),
  "/home/daytona/worker-env.sh"
);

// Use Daytona Sessions API for reliable background execution
const sessionId = `gen-${projectRecord.id.slice(0, 8)}`;
console.log("[API] Creating session:", sessionId);
try {
  await sandbox.process.createSession(sessionId);
} catch (e: any) {
  if (e.message && e.message.includes("conflict")) {
    console.log("[API] Reusing existing session:", sessionId);
  } else {
    throw e;
  }
}

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
