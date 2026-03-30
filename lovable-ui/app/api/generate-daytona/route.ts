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
        console.log("[API] Creating sandbox (2 CPU / 4GB RAM)...");
        sandbox = await daytona.create({
          public: false,
          image: "mcr.microsoft.com/playwright:v1.45.0-jammy",
          resources: { cpu: 2, memory: 4 }
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
import { execSync, spawn } from "child_process";
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retryable(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if ((e.status === 429 || (e.message && e.message.includes("429"))) && i < maxRetries - 1) {
        console.warn("[Worker] Quota exceeded (429). Retrying in 30s (" + (i+1) + "/" + (maxRetries) + ")...");
        await sendUpdate("progress", { message: "⚠️ Quota exceeded. Retrying in 30s..." });
        await sleep(30000);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  try {
    console.log("[Worker] Bootstrapping environment...");
    if (!fs.existsSync("package.json")) {
      fs.writeFileSync("package.json", JSON.stringify({ type: "module" }));
    }

    // Install system dependencies (Non-blocking)
    try {
      console.log("[Worker] Installing system dependencies (lsof, pnpm)...");
      const user = execSync("whoami", { encoding: "utf8" }).trim();
      console.log("[Worker] Agent user is: " + user);
      
      const aptCmd = (user === "root") ? "apt-get update && apt-get install -y lsof net-tools" : "sudo apt-get update && sudo apt-get install -y lsof net-tools";
      const pnpmCmd = (user === "root" || user === "daytona") ? "npm install -g pnpm" : "sudo npm install -g pnpm";
      
      try { execSync(aptCmd, { stdio: "inherit", timeout: 120000 }); } catch (e) { console.warn("[Worker] apt-get failed, continuing..."); }
      try { execSync(pnpmCmd, { stdio: "inherit", timeout: 60000 }); } catch (e) { console.warn("[Worker] pnpm install failed, continuing..."); }
    } catch (e) {
      console.warn("[Worker] System bootstrap failed:", e.message);
    }

    // Install core dependencies (Reduced weight: removed gen-ai)
    // Note: playwright should match the container image v1.45.0 to avoid re-downloading browsers
    const deps = ["playwright@1.45.0"]; 
    for (const dep of deps) {
      if (!fs.existsSync("./node_modules/" + dep.split("@")[0])) {
        console.log("[Worker] Installing " + dep + " (matching container)...");
        try {
          execSync("npm install " + dep, { encoding: "utf8" });
        } catch (e) { console.error("[Worker] Install failed for " + dep + ":", e.message); }
      }
    }

    // Now run the actual logic
    await runAgent();
    console.log("[Worker] Agent run complete.");
  } catch (err) {
    console.error("[Worker] Fatal error in main loop:", err);
    await sendUpdate("error", { 
      message: "Fatal: " + (err.message || "Unknown error"), 
      code: err.status === 429 ? "QUOTA_EXCEEDED" : "WORKER_FATAL",
      metadata: { stack: err.stack }
    });
    process.exit(1);
  }
}

const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "google/gemini-3.1-flash-lite-preview";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";
const PREVIEW_URL = process.env.PREVIEW_URL || ("https://" + SANDBOX_ID + ".daytona.app");
const SITE_URL = process.env.SITE_URL || "https://lovable-clone.vercel.app";
const INITIAL_HISTORY = JSON.parse(process.env.INITIAL_HISTORY || "[]");

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

// TOOL IMPLEMENTATIONS
const tools = {
  list_files: async ({ directory = "." }) => {
    if (typeof directory === "string") directory = directory.replace(/^:/, "");
    const target = path.join(projectDir, directory);
    if (!fs.existsSync(target)) return { error: "Directory not found" };
    const items = fs.readdirSync(target, { withFileTypes: true });
    return { files: items.map(i => ({ name: i.name, type: i.isDirectory() ? "dir" : "file" })) };
  },
  read_file: async ({ path: filePath }) => {
    if (typeof filePath === "string") filePath = filePath.replace(/^:/, "");
    const target = path.join(projectDir, filePath);
    if (!fs.existsSync(target)) return { error: "File not found" };
    return { content: fs.readFileSync(target, "utf-8") };
  },
  write_file: async ({ path: filePath, content }) => {
    if (typeof filePath === "string") filePath = filePath.replace(/^:/, "");
    const target = path.join(projectDir, filePath);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content);
    await sendUpdate("tool_use", { name: "write_file", input: { path: filePath } });
    return { success: true };
  },
  run_command: async ({ command }) => {
    if (typeof command === "string") command = command.replace(/^:/, "");
    console.log("[Tool] Running command:", command);
    await sendUpdate("tool_use", { name: "run_command", input: { command } });
    try {
      const output = execSync(command, { cwd: projectDir, encoding: "utf8", timeout: 60000 });
      return { stdout: output };
    } catch (e) {
      return { error: e.message, stderr: e.stderr?.toString(), stdout: e.stdout?.toString() };
    }
  },
  search_docs: async ({ vendor, project }) => {
    console.log("[Tool] Searching context7 for:", vendor, project);
    await sendUpdate("tool_use", { name: "search_docs", input: { vendor, project } });
    if (!CONTEXT7_API_KEY) return { error: "CONTEXT7_API_KEY not configured" };
    try {
      const resp = await fetch("https://context7.com/api/v1/" + vendor + "/" + project, {
        headers: { "Authorization": "Bearer " + CONTEXT7_API_KEY }
      });
      if (!resp.ok) return { error: "Context7 API error: " + resp.status };
      return await resp.json();
    } catch (e) { return { error: "Search failed: " + e.message }; }
  },
  take_screenshot: async () => {
    console.log("[Tool] Taking screenshot...");
    await sendUpdate("tool_use", { name: "take_screenshot", input: {} });
    try {
      const { chromium } = await import("playwright");
      // Browsers are already installed in this image! No npx install needed.
      const browser = await chromium.launch({ 
        args: ["--no-sandbox", "--disable-setuid-sandbox"] // Required for some Docker environments
      });
      const page = await browser.newPage();
      await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
      const buffer = await page.screenshot();
      await browser.close();
      return { 
        screenshot_base64: buffer.toString("base64"),
        note: "Site is live at " + PREVIEW_URL
      };
    } catch (e) { 
      console.error("[Tool] Screenshot failed:", e.message);
      return { error: "Could not take screenshot. Ensure the server is running on port 3000 and dependencies are met. Details: " + e.message }; 
    }
  },
  report_progress: async ({ message }) => {
    console.log("[Tool] Progress update:", message);
    await sendUpdate("progress", { message });
    return { success: true };
  },
  is_port_in_use: async ({ port = 3000 }) => {
    console.log("[Tool] Checking port:", port);
    try {
      // Use lsof if available, fallback to netstat
      try {
        const out = execSync("lsof -i :" + port + " -t", { encoding: "utf8" }).trim();
        return { port, inUse: out.length > 0, pid: out || null };
      } catch (e) {
        // lsof returns 1 if not found
        return { port, inUse: false };
      }
    } catch (err) { return { error: err.message }; }
  }
};

const toolsList = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in a directory of the project.",
      parameters: { type: "object", properties: { directory: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the content of a file.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Use this to create or update project files.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command (e.g., npm install, npm test, lint).",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
    }
  },
  {
    type: "function",
    function: {
      name: "search_docs",
      description: "Get documentation for a library from Context7.",
      parameters: { type: "object", properties: { vendor: { type: "string" }, project: { type: "string" } }, required: ["vendor", "project"] }
    }
  },
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Take a screenshot of the website running at http://localhost:3000 to verify visual correctness.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "report_progress",
      description: "Report a high-level progress message to the user (e.g., 'Drafting the navigation menu...', 'Researching library options...'). Use this to keep the user updated during complex tasks.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
    }
  },
  {
    type: "function",
    function: {
      name: "is_port_in_use",
      description: "Check if a specific port is already being used by a process.",
      parameters: { type: "object", properties: { port: { type: "number" } } }
    }
  }
];

async function runAgent() {
  console.log("[Worker] runAgent() starting...");
  await sendUpdate("progress", { message: "Agent active..." });

  const isResuming = INITIAL_HISTORY.length > 0;
  const systemMessage = "You are a Senior Developer Agent. Build a complete website. ENVIRONMENT: Node v20.15.0 is present. PREFERENCE: By default, use React, Vite, and Tailwind CSS unless the user specifies otherwise. DESIGN: Aim for premium, modern aesthetics (vibrant colors, sleek dark modes, glassmorphism, smooth animations). WORKFLOW: 1. Research/Plan. 2. Initialize Project: If not present, initialize React+Vite in the current directory using 'npm create vite@5 . -- --template react -- --yes'. 3. Setup Tailwind: Install tailwindcss, postcss, autoprefixer and configure them. 4. Write code (write_file). 5. Dependencies: run 'npm install --no-audit --no-fund'. 6. Launch: 'npm run dev &'. 7. Verify: Use 'is_port_in_use' and 'take_screenshot'. STRICT RULES: 1. LOCK VERSIONS: Use Vite 5, NOT Vite latest, to maintain Node.js compatibility. 2. PLAYWRIGHT: If you must install playwright, use 'playwright@1.45.0' to match the system image. 3. NEVER use a leading colon (:) in shell commands. Use 'ls', not ':ls'. 4. ALWAYS install dependencies before starting the server. 5. Use report_progress frequently. When finished, summarize your work.";
  
  let messages = [];
  if (isResuming) {
    console.log("[Worker] Resuming from history (" + INITIAL_HISTORY.length + " msgs)");
    messages = INITIAL_HISTORY;
    // Add a reminder that we are resuming and should check the current state
    messages.push({ 
      role: "user", 
      content: "I'm opening this project again. Please check the current files and see if the preview server is running (at port 3000). If not running, start it. Then continue with my initial request: " + PROMPT 
    });
  } else {
    messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: "User Request: " + PROMPT }
    ];
  }

  let turns = 0;
  const maxTurns = 40;

  while (turns < maxTurns) {
    turns++;
    console.log("\n[" + new Date().toLocaleTimeString() + "] === Turn " + turns + " ===");
    if (turns > 1 || isResuming) await sendUpdate("progress", { message: "Thinking about next steps..." });

    const response = await retryable(async () => {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + OPENROUTER_API_KEY,
          "HTTP-Referer": SITE_URL,
          "X-Title": "Lovable Clone"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: messages,
          tools: toolsList,
          tool_choice: "auto",
          cache_control: { type: "ephemeral" },
          user: PROJECT_ID,
          session_id: PROJECT_ID
        })
      });

      if (!resp.ok) {
        const txt = await resp.text();
        const err = new Error("OpenRouter API Error: " + resp.status + " " + txt);
        err.status = resp.status;
        throw err;
      }
      return await resp.json();
    });

    const choice = response.choices[0];
    const message = choice.message;
    messages.push(message);

    // LOG THOUGHTS
    if (message.content) {
      console.log("[Thought]:", message.content);
    }

    if (response.usage) {
      console.log("[Usage]: " + response.usage.prompt_tokens + " prompt + " + response.usage.completion_tokens + " completion tokens");
    }

    // PERSIST ASSISTANT MESSAGE
    await sendUpdate("claude_message", { 
      content: message.content || "", 
      metadata: { 
        tool_calls: message.tool_calls,
        genId: response.id,
        usage: response.usage
      } 
    });

    if (choice.finish_reason === "stop" || !message.tool_calls) {
      console.log("[Worker] Agent finished.");
      console.log("--------------------------");
      await sendUpdate("complete", { 
        message: message.content || "Project build complete!", 
        metadata: { 
          sandboxId: SANDBOX_ID, 
          previewUrl: PREVIEW_URL,
          genId: response.id,
          usage: response.usage
        } 
      });
      return;
    }

    console.log("[Worker] Processing tool calls:", message.tool_calls.length);
    
    // Execute multiple tool calls in parallel for efficiency where safe
    const toolResults = await Promise.all(message.tool_calls.map(async (toolCall) => {
      const { name, arguments: argsString } = toolCall.function;
      const args = JSON.parse(argsString);
      console.log("[Tool Call]:", name + "(" + JSON.stringify(args) + ")");
      const handler = tools[name];
      
      let result;
      if (handler) {
        try {
          result = await handler(args);
        } catch (e) { result = { error: e.message }; }
      } else {
        result = { error: "Unknown tool" };
      }

      console.log("[Tool Result]:", name, JSON.stringify(result).slice(0, 500) + (JSON.stringify(result).length > 500 ? "..." : ""));

      // Context Window Management: If this is a screenshot, we keep the original for the LLM now,
      // but we will truncate it in the history later to save tokens.
      const toolMsg = {
        role: "tool",
        tool_call_id: toolCall.id,
        name: name,
        content: JSON.stringify(result)
      };

      // PERSIST TOOL RESULT
      await sendUpdate("tool_result", { content: toolMsg.content, metadata: { tool_call_id: toolCall.id, name: name } });
      
      return toolMsg;
    }));

    // Add all results to message history
    messages.push(...toolResults);

    // Context Window Optimization: After tool results are added, 
    // find past screenshot results and replace with a summary to save tokens.
    // We keep the last 2 turns of results intact for immediate context.
    if (messages.length > 5) {
      for (let i = 0; i < messages.length - 3; i++) {
        const msg = messages[i];
        if (msg.role === "tool" && msg.name === "take_screenshot" && msg.content.length > 1000) {
          console.log("[Worker] Cleaning up old screenshot tokens...");
          msg.content = JSON.stringify({ note: "Screenshot removed to save tokens. The visual state was previously analyzed.", success: true });
        }
      }
    }
  }

  console.warn("[Worker] Max turns reached.");
  await sendUpdate("complete", { 
    message: "I've made some progress! Click continue to keep building.", 
    metadata: { 
      sandboxId: SANDBOX_ID, 
      previewUrl: PREVIEW_URL,
      reachedLimit: true,
      genId: response?.id,
      usage: response?.usage
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

// Get actual signed preview link from Daytona SDK (bypasses warning page in iframes)
console.log("[API] Getting signed preview link for port 3000...");
let previewUrl = `https://${sandboxId}.daytona.app`; // Fallback
try {
  // 3600 seconds = 1 hour expiry
  const signedPreview = await sandbox.getSignedPreviewUrl(3000, 3600);
  previewUrl = signedPreview.url;
  console.log("[API] Signed preview URL obtained:", previewUrl.slice(0, 50) + "...");
} catch (e: any) {
  console.warn("[API] Could not get signed preview link via SDK, falling back to standard link:", e.message);
  try {
    const preview = await sandbox.getPreviewLink(3000);
    previewUrl = preview.url;
  } catch (err) {
    console.warn("[API] Standard preview link also failed, using raw fallback");
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
