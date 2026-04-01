import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

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

const ROBUST_PATH = "export PATH=$HOME/.local/bin:$HOME/.cargo/bin:/home/daytona/.local/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH && export GAI_STRATEGY=inet";

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  lastUpdateAt = Date.now();
  console.log(`[Worker] Sending ${type} update to ${WEBHOOK_URL}`);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data }),
      signal: AbortSignal.timeout(10000) // 10s timeout
    });
    if (!res.ok) console.warn("[Worker] Update failed status:", res.status);
    else console.log(`[Worker] Update ${type} sent successfully.`);
  } catch (e) { 
    console.warn("[Worker] Update failed:", e.message); 
    if (e.message.includes("resolution") || e.message.includes("fetch failed")) {
      console.error("[Worker] CRITICAL: Webhook URL is unreachable. Local development requires a tunnel (ngrok).");
    }
  }
}

function runCommand(command, options = {}) {
  const cmdWithEnv = `${ROBUST_PATH} && export UV_CACHE_DIR=/home/daytona/.uv-cache && ${command}`;
  console.log(`[Worker] Executing: ${command}`);
  // Debug: check disk usage
  try { execSync(`${ROBUST_PATH} && df -h / | tail -1`, { stdio: "inherit", shell: true }); } catch (e) {}
  
  return new Promise((resolve, reject) => {
    const cp = spawn(cmdWithEnv, [], { shell: true, stdio: "inherit", ...options });
    cp.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed with code ${code}`)));
  });
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

const projectDir = "/home/daytona/website-project";
if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

async function main() {
  try {
    console.log("[Worker] Starting main loop. Checking network...");
    // 0. Pre-flight check
    try {
       const controller = new AbortController();
       const timeoutId = setTimeout(() => controller.abort(), 5000);
       await fetch(WEBHOOK_URL, { method: "HEAD", signal: controller.signal }).catch(() => {});
       clearTimeout(timeoutId);
    } catch (e) {}

    startFriendlyRotation();
    process.env.PATH = (process.env.HOME || "/home/daytona") + "/.local/bin:" + (process.env.HOME || "/home/daytona") + "/.cargo/bin:" + process.env.PATH;
    
    let isInstalled = false;
    const venvBin = "/home/daytona/.openhands-venv/bin/python3";
    
    try {
      if (fs.existsSync(venvBin)) {
        isInstalled = true;
        console.log("[Worker] OpenHands virtualenv found.");
      }
    } catch (e) {}

    if (!isInstalled) {
      await sendUpdate("progress", { message: "🚀 Environment setup: Installing uv..." });
      try { 
        const installUvCmd = `mkdir -p ~/.local/bin && if [ ! -f ~/.local/bin/uv ]; then ( curl -4 -L --connect-timeout 15 --max-time 45 --retry 3 https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz -o uv.tar.gz && tar -xzf uv.tar.gz && chmod +x uv-x86_64-unknown-linux-gnu/uv && mv uv-x86_64-unknown-linux-gnu/uv ~/.local/bin/ && mv uv-x86_64-unknown-linux-gnu/uvx ~/.local/bin/ && rm -rf uv.tar.gz uv-x86_64-unknown-linux-gnu ); fi`;
        await runCommand(installUvCmd); 
      } catch (e) {
        console.warn("[Worker] uv installation failed, attempting fallback...");
      }

      await sendUpdate("progress", { message: "🤖 Creating isolated environment..." });
      try {
        await runCommand("uv venv /home/daytona/.openhands-venv");
        await sendUpdate("progress", { message: "📦 Installing OpenHands (this may take a minute)..." });
        await runCommand(". /home/daytona/.openhands-venv/bin/activate && uv pip install openhands");
      } catch (e) {
        console.error("[Worker] OpenHands installation failed.", e);
        throw new Error("Failed to prepare OpenHands environment. Please try again.");
      }
    }

    const rules = [
      "# Lovabee Agent Rules",
      "- Tech: React, Vite, Tailwind CSS",
      "- Style: Premium, modern aesthetics (rich gradients, Inter font, glassmorphism)",
      "- Architecture: Feature-based structure",
      "- Port: 3000 (Required for preview)",
      "- Note: Always use Lucide React for icons."
    ].join("\n");
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), rules);

    await sendUpdate("progress", { message: "🐝 Lovabee AI is planning your website..." });
    await runAgentSDK(venvBin);

    // Validate that some files were actually created
    const hasPackageJson = fs.existsSync(path.join(projectDir, "package.json"));
    if (!hasPackageJson) {
      console.error("[Worker] Agent finished but package.json was not found. Generation likely failed.");
      await sendUpdate("error", { message: "Agent failed to generate the website files. Please check your prompt and try again." });
      return;
    }

    await sendUpdate("progress", { message: "🔗 Launching preview..." });
    try { execSync("fuser -k 3000/tcp 2>/dev/null || pkill -f \"vite\" 2>/dev/null || true"); } catch (e) {}
    await runCommand("nohup npx vite --host 0.0.0.0 --port 3000 > /home/daytona/dev-server.log 2>&1 &", { cwd: projectDir });

    await sendUpdate("complete", { 
      message: "Build complete! 🎉", 
      metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL, engine: "openhands-sdk" } 
    });
  } catch (err) {
    console.error("[Worker] Fatal error:", err);
    await sendUpdate("error", { message: "Error: " + err.message });
    process.exit(1);
  }
}

async function runAgentSDK(pythonPath) {
  const env = { 
    ...process.env, 
    LLM_API_KEY: OPENROUTER_API_KEY, 
    LLM_BASE_URL: "https://openrouter.ai/api/v1", 
    LLM_MODEL: MODEL,
    OPENHANDS_WORKSPACE_BASE: projectDir,
    OPENHANDS_SID: process.env.OPENHANDS_SID,
    PYTHONUNBUFFERED: "1"
  };
  
  const runnerPath = "/home/daytona/agent_runner.py";
  const command = `${ROBUST_PATH} && ${pythonPath} ${runnerPath}`;

  console.log(`[Worker] Running Agent SDK with command: ${command}`);

  return new Promise((resolve, reject) => {
    const cp = spawn("/bin/sh", ["-c", command], { env, cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
    
    cp.stdout.on("data", (data) => {
      const output = data.toString();
      process.stdout.write(output);
      
      const lines = output.split("\n");
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const payload = JSON.parse(line);
          if (payload.type === "progress") sendUpdate("progress", { message: payload.message });
          if (payload.type === "error") console.warn("[Runner Error]", payload.message);
        } catch (e) { }
      }
    });

    cp.stderr.on("data", (data) => { process.stderr.write(data.toString()); });
    cp.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent SDK exit ${code}. Check runner logs.`));
    });
  });
}

main();
