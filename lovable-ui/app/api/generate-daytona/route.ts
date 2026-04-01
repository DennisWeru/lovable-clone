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

    if (!profile || (profile.credits || 0) < 150) {
      return NextResponse.json({ error: "Insufficient credits: Please top up to continue generation (Min 150 credits needed)." }, { status: 403 });
    }

    // --- MONETIZATION: Deduct Platform / Sandbox Activation Fee (100 credits) ---
    console.log("[API] Deducting 100 credits for work session activation...");
    const { error: rpcError } = await supabaseAdmin.rpc("decrement_credits", {
      user_id: userId,
      amount: 100
    });

    if (rpcError) {
      console.error("[API] Failed to deduct activation fee:", rpcError);
      return NextResponse.json({ error: "Credit deduction failed: Please try again." }, { status: 500 });
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
const MODEL = process.env.GENERATION_MODEL || "google/gemini-3.1-flash-lite-preview";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";
const PREVIEW_URL = process.env.PREVIEW_URL || ("https://" + SANDBOX_ID + ".daytona.app");
const SITE_URL = process.env.SITE_URL || "https://lovabee.vercel.app";

const FRIENDLY_MESSAGES = [
  "Analyzing your request and planning the best approach... 🐝",
  "Designing a modern, responsive layout for your app...",
  "Fine-tuning the UI components for a premium feel... 🍯",
  "Setting up the project structure and dependencies...",
  "Implementing your custom features with Lovabee's assistance...",
  "Almost there! Polishing the final details...",
  "This is going to look great! 🌟",
  "Optimizing performance and ensuring smooth transitions...",
  "Crafting a beautiful color palette for your design... 🌻",
  "Ensuring mobile responsiveness and cross-device compatibility...",
  "Applying best practices for clean, maintainable code...",
  "Adding subtle micro-animations for an enhanced experience...",
  "Still working on it! Building complex features takes a moment...",
  "The Lovabee agent is currently busy writing high-quality code..."
];

let lastUpdateAt = Date.now();
let currentFriendlyIndex = 0;

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  lastUpdateAt = Date.now();
  console.log("[Worker Checkpoint] Sending update:", type);
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data }),
      signal: controller.signal
    });
    clearTimeout(id);
  } catch (e) { 
    console.warn("[Worker] sendUpdate failed/timed out:", type, e.message); 
    console.log("[Worker Internal Status]", type, data.message || "");
  }
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
    await sendUpdate("progress", { message: "🚀 Preparing a fresh environment for your project..." });
    console.log("[Worker] Bootstrapping environment...");

    // Auto-detect a non-root user and drop privileges if running as root
    try {
      const currentUid = execSync("id -u", { encoding: "utf8" }).trim();
      const currentWhoami = execSync("whoami", { encoding: "utf8" }).trim();
      console.log("[Worker] Starting as user: " + currentWhoami + " (uid: " + currentUid + ")");
      
      if (currentUid === "0") {
        let nonRootUser = null;
        for (const u of ["daytona", "pwuser", "ubuntu", "node", "app"]) {
          try {
            execSync("id -u " + u, { stdio: "ignore" });
            nonRootUser = u;
            break;
          } catch (e) {}
        }
        
        if (nonRootUser) {
          console.log("[Worker] Found non-root user '" + nonRootUser + "'. Changing ownership and dropping privileges...");
          execSync("chown -R " + nonRootUser + " /home/daytona");
          process.setgid(nonRootUser);
          process.setuid(nonRootUser);
          process.env.HOME = "/home/daytona";
          process.env.USER = nonRootUser;
          console.log("[Worker] Successfully switched to user: " + nonRootUser);
        } else {
          console.warn("[Worker] WARNING: Could not find a standard non-root user to switch to.");
        }
      }
    } catch (e) {
      console.warn("[Worker] Privilege drop check error:", e.message);
    }

    if (!fs.existsSync("package.json")) {
      fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
    }

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
      await sendUpdate("progress", { message: "📦 Initializing the Claude Code agent... This happens only once." });
      console.log("[Worker] Claude CLI not found. Installing locally...");
      
      if (!fs.existsSync(localClaudeDir)) fs.mkdirSync(localClaudeDir, { recursive: true });
      if (!fs.existsSync(path.join(localClaudeDir, "package.json"))) {
        fs.writeFileSync(path.join(localClaudeDir, "package.json"), JSON.stringify({ name: "claude-env", type: "module" }));
      }
      
      const npmCmd = "cd " + localClaudeDir + " && npm install @anthropic-ai/claude-code --no-fund --no-audit --no-update-notifier --loglevel error --cache /home/daytona/.npm-cache";
      
      try {
        console.log("[Worker] Running:", npmCmd);
        const out = execSync(npmCmd, { 
          encoding: "utf8",
          env: { ...process.env, NPM_CONFIG_CACHE: "/home/daytona/.npm-cache" }
        });
        console.log("[Worker] NPM INSTALL OUTPUT:", out);

        if (fs.existsSync(localClaudeBin)) {
          claudeBinary = localClaudeBin;
          console.log("[Worker] Claude CLI installed at:", localClaudeBin);
        } else {
          console.warn("[Worker] Binary not found even after install. Falling back to npx.");
          claudeBinary = "npx --yes @anthropic-ai/claude-code";
        }
      } catch (err) {
        console.warn("[Worker] Local install failed, fallback to npx", err.message);
        claudeBinary = "npx --yes @anthropic-ai/claude-code";
        await sendUpdate("progress", { message: "⚠️ Optimizing installation process..." });
      }
    }

    const rules = [
      "# Project Rules",
      "- Environment: Node v20.15.0",
      "- Preferred Stack: React, Vite 5, Tailwind CSS.",
      "- Commands: Use 'npm' for all tasks.",
      "- Preview: Websites must run on port 3000.",
      "- Host: Use 'npx vite --host 0.0.0.0 --port 3000' to start the dev server.",
      "- Persistence: Always install dependencies before starting the server.",
      "- Visuals: Aim for premium, modern aesthetics."
    ].join("\n");
    console.log("[Worker] Writing CLAUDE.md...");
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), rules);

    const snapshotScript = [
      "(async () => {",
      "  const p = 'play' + 'wright';",
      "  const { chromium } = await import(/* webpackIgnore: true */ p);",
      "  const fs = await import('fs');",
      "  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });",
      "  const page = await browser.newPage();",
      "  try {",
      "    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });",
      "    const buffer = await page.screenshot();",
      "    fs.writeFileSync('/home/daytona/latest-screenshot.png', buffer);",
      "  } catch (err) {",
      "    console.error('Screenshot failed:', err);",
      "    process.exit(1);",
      "  } finally {",
      "    await browser.close();",
      "  }",
      "})();"
    ].join("\n");
    fs.writeFileSync("/home/daytona/snapshot.mjs", snapshotScript);

    console.log("[Worker Checkpoint] Entering runClaude...");
    await runClaude(claudeBinary);

    console.log("[Worker] Agent finished. Starting server...");
    await sendUpdate("progress", { message: "🔗 Starting the preview server..." });
    
    try {
      execSync('fuser -k 3000/tcp 2>/dev/null || pkill -f "vite" 2>/dev/null || true');
      const startCmd = 'cd ' + projectDir + ' && nohup npx vite --host 0.0.0.0 --port 3000 > /home/daytona/dev-server.log 2>&1 &';
      console.log("[Worker] Starting server with:", startCmd);
      execSync(startCmd);
      
      let isReady = false;
      for (let i = 0; i < 20; i++) {
        try {
          const httpCode = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000', { encoding: 'utf8' }).trim();
          if (httpCode === "200" || httpCode === "304") {
            isReady = true;
            console.log("[Worker] Server is READY");
            break;
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error("[Worker] Error starting dev server:", err);
    }

    await sendUpdate("complete", { 
      message: "Success! Your project is ready for preview. 🎉", 
      metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL, engine: "claude-code" } 
    });
  } catch (err) {
    console.error("[Worker] Fatal error:", err);
    await sendUpdate("error", { message: "Generation failed: " + err.message });
    process.exit(1);
  }
}

async function runClaude(command) {
  console.log("[Worker Checkpoint] runClaude started");
  await sendUpdate("progress", { message: "🤖 Lovabee Agent is thinking..." });
  
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api/v1",
    ANTHROPIC_AUTH_TOKEN: OPENROUTER_API_KEY,      
    ANTHROPIC_API_KEY: "",                      
    ANTHROPIC_MODEL: MODEL,                     
    CLAUDE_MODEL: MODEL,                        
    NPM_CONFIG_CACHE: "/home/daytona/.npm-cache" 
  };

  const args = [ "--bare", "-p", PROMPT, "--model", MODEL, "--dangerously-skip-permissions" ];
  let actualCmd = command;
  let actualArgs = [...args];
  if (command.startsWith("npx")) {
    const parts = command.split(" ");
    actualCmd = parts[0];
    actualArgs = [...parts.slice(1), ...args];
  }

  return new Promise((resolve, reject) => {
    console.log("[Worker] Spawning agent:", actualCmd, actualArgs.join(" "));
    const cp = spawn(actualCmd, actualArgs, { env, cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
    
    cp.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write("[Claude STDOUT]: " + text); 
      if (text.includes("Tool")) sendUpdate("progress", { message: "Agent active with tools..." });
    });

    cp.stderr.on("data", (data) => {
      process.stderr.write("[Claude STDERR]: " + data.toString()); 
    });

    cp.on("close", (code) => {
      console.log("[Worker Checkpoint] Claude process closed code:", code);
      if (code === 0) resolve(); else reject(new Error("Claude exited with code " + code));
    });

    cp.on("error", (err) => {
      console.error("[Worker] Process spawn error:", err);
      reject(err);
    });
  });
}

main();
`;

    // 7. Upload files and execute in Sandbox using proper SDK APIs
    const workerPath = "/home/daytona/generation-worker.mjs";
    console.log("[API] Uploading worker script...");
    await sandbox.fs.uploadFile(Buffer.from(workerContent), workerPath);

    let protocol = "https";
    const host = req.headers.get("host") || "lovabee.vercel.app";
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      protocol = "http";
    }
    
    let webhookUrl = process.env.WEBHOOK_BASE_URL 
      ? `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`
      : `${protocol}://${host}/api/webhooks/daytona-progress`;

    console.log("[API] Webhook URL set to:", webhookUrl);

    console.log("[API] Getting preview link for port 3000...");
    let previewUrl = `https://${sandboxId}.daytona.app`; 
    try {
      const preview = await sandbox.getPreviewLink(3000);
      previewUrl = preview.url;
    } catch (e: any) {
      try {
        const signedPreview = await sandbox.getSignedPreviewUrl(3000, 7200);
        previewUrl = signedPreview.url;
      } catch (err) {}
    }

    const envFileContent = Object.entries({
      GENERATION_PROMPT: prompt,
      GENERATION_MODEL: model || "google/gemini-3.1-flash-lite-preview",
      PROJECT_ID: projectRecord.id,
      WEBHOOK_TOKEN: webhookToken,
      WEBHOOK_URL: webhookUrl,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      SANDBOX_ID: sandboxId,
      PREVIEW_URL: previewUrl,
      SITE_URL: `${protocol}://${host}`,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      INITIAL_HISTORY: JSON.stringify(initialHistory)
    }).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");

    console.log("[API] Uploading .env file...");
    await sandbox.fs.uploadFile(Buffer.from(envFileContent), "/home/daytona/worker-env.sh");

    const sessionId = `gen-${projectRecord.id.slice(0, 8)}`;
    console.log("[API] Creating session:", sessionId);
    try {
      await sandbox.process.createSession(sessionId);
    } catch (e: any) {
      if (!e.message.includes("conflict")) throw e;
    }

    console.log("[API] Launching worker in session...");
    const sessionResult = await sandbox.process.executeSessionCommand(sessionId, {
      command: `source /home/daytona/worker-env.sh && cd /home/daytona && node ${workerPath} > /home/daytona/worker.log 2>&1`,
      runAsync: true,
    });
    console.log("[API] Session command launched, cmdId:", sessionResult.cmdId);

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
