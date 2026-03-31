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

const FRIENDLY_MESSAGES = [
  "Analyzing your request and planning the best approach...",
  "Designing a modern, responsive layout for your app...",
  "Fine-tuning the UI components for a premium feel...",
  "Setting up the project structure and dependencies...",
  "Implementing your custom features with Claude's assistance...",
  "Almost there! Polishing the final details...",
  "This is going to look great! 🌟",
  "Optimizing performance and ensuring smooth transitions...",
  "Crafting a beautiful color palette for your design...",
  "Ensuring mobile responsiveness and cross-device compatibility...",
  "Applying best practices for clean, maintainable code...",
  "Adding subtle micro-animations for an enhanced experience...",
  "Still working on it! Building complex features takes a moment...",
  "The agent is currently busy writing high-quality code..."
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
  } catch (e) { console.error("[Worker] sendUpdate failed:", type, e.message); }
}

function startFriendlyRotation() {
  setInterval(async () => {
    // Only send if no update in the last 15 seconds
    if (Date.now() - lastUpdateAt > 15000) {
      const msg = FRIENDLY_MESSAGES[currentFriendlyIndex];
      currentFriendlyIndex = (currentFriendlyIndex + 1) % FRIENDLY_MESSAGES.length;
      await sendUpdate("progress", { message: "✨ " + msg });
    }
  }, 15000);
}

const projectDir = path.join(process.cwd(), "website-project");
if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

async function main() {
  try {
    startFriendlyRotation();
    await sendUpdate("progress", { message: "🚀 Preparing a fresh environment for your project..." });
    console.log("[Worker] Bootstrapping environment...");

    // 1. Ensure basic package.json for the sandbox root
    if (!fs.existsSync("package.json")) {
      fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
    }

    // 2. Ensure Claude CLI is available (Optimized: Check local, global, then install locally)
    let claudeBinary = "claude";
    const localClaudeDir = "/home/daytona/.claude";
    const localClaudeBin = path.join(localClaudeDir, "node_modules", ".bin", "claude");

    try {
      console.log("[Worker] Checking for Claude CLI...");
      if (fs.existsSync(localClaudeBin)) {
        claudeBinary = localClaudeBin;
        console.log("[Worker] Using persistent local Claude CLI:", claudeBinary);
      } else {
        execSync("claude --version", { stdio: "ignore" });
        console.log("[Worker] Using global Claude CLI");
      }
    } catch (e) {
      await sendUpdate("progress", { message: "📦 Initializing the Claude Code agent... This happens only once and might take a few minutes." });
      console.log("[Worker] Claude CLI not found. Installing locally to ensure persistence and speed...");
      
      if (!fs.existsSync(localClaudeDir)) fs.mkdirSync(localClaudeDir, { recursive: true });
      
      // Use local install - typically more reliable than global in container environments
      // Added flags to speed up and reduce noise
      const npmCmd = "cd " + localClaudeDir + " && npm install @anthropic-ai/claude-code --no-fund --no-audit --no-update-notifier --loglevel error";
      
      try {
        console.log("[Worker] Running:", npmCmd);
        // No timeout here - we've seen it take up to 14 mins in some environments
        execSync(npmCmd, { stdio: "inherit" });
        if (fs.existsSync(localClaudeBin)) {
          claudeBinary = localClaudeBin;
        } else {
          claudeBinary = "npx --yes @anthropic-ai/claude-code";
        }
      } catch (err) {
        console.warn("[Worker] Local install failed, will fall back to direct npx run", err.message);
        claudeBinary = "npx --yes @anthropic-ai/claude-code";
        await sendUpdate("progress", { message: "⚠️ Optimizing installation process... Falling back to on-demand execution." });
      }
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
    await runClaude(claudeBinary);

    console.log("[Worker] Claude Code run complete. Ensuring dev server is active...");
    await sendUpdate("progress", { message: "🔗 Plugging everything together and starting the preview server..." });
    
    // 6. Ensure dev server is running persistently
    try {
      // Kill any existing server on port 3000 to avoid 'Address already in use'
      execSync('fuser -k 3000/tcp 2>/dev/null || pkill -f "vite" 2>/dev/null || true');
      
      // Start dev server with nohup for persistence
      const startCmd = 'cd ' + projectDir + ' && nohup npx vite --host 0.0.0.0 --port 3000 > /home/daytona/dev-server.log 2>&1 &';
      console.log("[Worker] Starting server with:", startCmd);
      execSync(startCmd);
      
      // Wait for server to be ready (up to 10 seconds)
      console.log("[Worker] Waiting for server to respond on port 3000...");
      let isReady = false;
      for (let i = 0; i < 10; i++) {
        try {
          const httpCode = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000', { encoding: 'utf8' }).trim();
          if (httpCode === "200" || httpCode === "304") {
            isReady = true;
            console.log("[Worker] Server is READY (HTTP " + httpCode + ")");
            break;
          }
        } catch (e) {
          // Ignore curl errors
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (!isReady) {
        console.warn("[Worker] Server not responding yet, but proceeding to complete.");
      }
    } catch (err) {
      console.error("[Worker] Error starting dev server:", err);
      // We don't reject here because Claude might have actually finished the code, 
      // and we want the user to at least see the logs.
    }

    // Final completion message
    await sendUpdate("complete", { 
      message: "Success! Your project is ready for preview. 🎉", 
      metadata: { 
        sandboxId: SANDBOX_ID, 
        previewUrl: PREVIEW_URL,
        engine: "claude-code"
      } 
    });
  } catch (err) {
    console.error("[Worker] Fatal error in main loop:", err);
    await sendUpdate("error", { 
      message: "Something went wrong: " + (err.message || "Unknown error"), 
      metadata: { stack: err.stack }
    });
    process.exit(1);
  }
}

async function runClaude(command) {
  await sendUpdate("progress", { message: "🤖 Lovable Agent is thinking about your project..." });
  
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_API_KEY: OPENROUTER_API_KEY,      // Required for auth via OpenRouter
    ANTHROPIC_AUTH_TOKEN: OPENROUTER_API_KEY,   // Secondary for some configurations
    CLAUDE_MODEL: MODEL,                        // Selected model name
    NPM_CONFIG_CACHE: "/home/daytona/.npm-cache" // Persistent cache for npx
  };

  // Construct the command parts
  let actualCmd = command;
  let actualArgs = [...args];

  // If command is npx, we need to handle the arguments carefully
  if (command.startsWith("npx")) {
    const parts = command.split(" ");
    actualCmd = parts[0];
    actualArgs = [...parts.slice(1), ...args];
  }

  return new Promise((resolve, reject) => {
    console.log("[Worker] Spawning:", actualCmd, actualArgs.join(" "));
    
    // Using stdio: ['ignore', 'pipe', 'pipe'] to simulate < /dev/null and skip the 3s delay
    const cp = spawn(actualCmd, actualArgs, { 
      env, 
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"] 
    });
    
    const setupHandlers = (proc) => {
      proc.stdout.on("data", (data) => {
        const text = data.toString();
        process.stdout.write("[Claude STDOUT]: " + text); // Debug in worker log
        
        // Filter out ANSI codes and noise if needed, but for now just send it
        // The frontend will treat this as 'Thinking about next steps...' or similar 
        // if no progress message is sent, but we can also use 'Agent active with tools...'
        // to trigger the frontend's special handling
        sendUpdate("progress", { message: "Agent active with tools..." });
      });

      proc.stderr.on("data", (data) => {
        const errText = data.toString();
        process.stderr.write("[Claude STDERR]: " + errText); // Debug in worker log
        if (!errText.includes("warning") && !errText.includes("Deprecation")) {
           // Don't spam the user with stderr unless it looks important
           // sendUpdate("progress", { message: "⚠️ " + errText });
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          console.log("[Worker] Claude finished successfully.");
          resolve();
        } else {
          const errorMsg = "Claude exited with code " + code;
          console.error("[Worker]", errorMsg);
          reject(new Error(errorMsg));
        }
      });

      proc.on("error", (err) => {
        console.error("[Worker] Process error:", err);
        reject(err);
      });
    };

    if (cp.pid) {
      setupHandlers(cp);
    }
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
