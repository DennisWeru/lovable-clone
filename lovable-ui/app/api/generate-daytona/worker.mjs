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

const ROBUST_PATH = "export PATH=$HOME/.local/bin:$HOME/.cargo/bin:/home/daytona/.local/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH";

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  lastUpdateAt = Date.now();
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data })
    });
    if (!res.ok) console.warn("[Worker] Update failed status:", res.status);
  } catch (e) { console.warn("[Worker] Update failed:", e.message); }
}

function runCommand(command, options = {}) {
  const cmdWithEnv = `${ROBUST_PATH} && ${command}`;
  console.log(`[Worker] Executing: ${command}`);
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

const projectDir = path.join(process.cwd(), "website-project");
if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

async function main() {
  try {
    startFriendlyRotation();
    process.env.PATH = (process.env.HOME || "/home/daytona") + "/.local/bin:" + (process.env.HOME || "/home/daytona") + "/.cargo/bin:" + process.env.PATH;
    let binaryPath = "openhands";
    let isInstalled = false;
    try {
      execSync(`${ROBUST_PATH} && which openhands`, { stdio: "ignore", shell: true });
      isInstalled = true;
      console.log("[Worker] OpenHands already available.");
    } catch (e) {}

    if (!isInstalled) {
      await sendUpdate("progress", { message: "🚀 Environment setup: Installing uv..." });
      try { 
        // Force IPv4, add hard timeouts to prevent hanging. Download binary directly instead of using the sh script because the script's inner curl commands lack timeouts.
        const installUvCmd = `mkdir -p ~/.local/bin && ( (curl -4 -L --connect-timeout 15 --max-time 45 --retry 3 https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz -o uv.tar.gz && tar -xzf uv.tar.gz && chmod +x uv-x86_64-unknown-linux-gnu/uv && mv uv-x86_64-unknown-linux-gnu/uv ~/.local/bin/ && mv uv-x86_64-unknown-linux-gnu/uvx ~/.local/bin/ && rm -rf uv.tar.gz uv-x86_64-unknown-linux-gnu) || (sudo apt-get update -y && sudo apt-get install -y python3-pip python3-venv && python3 -m venv ~/.uv-venv && ~/.uv-venv/bin/pip install uv && ln -sf ~/.uv-venv/bin/uv ~/.local/bin/uv) )`;
        await runCommand(installUvCmd); 
      } catch (e) {
        console.warn("[Worker] uv installation failed or timed out, proceeding to check if partial install worked...");
      }

      await sendUpdate("progress", { message: "🤖 Installing OpenHands (this may take a minute)..." });
      try {
        // Use a persistent venv for openhands
        await runCommand("uv venv --python 3.12 /home/daytona/.openhands-venv");
        await runCommand(". /home/daytona/.openhands-venv/bin/activate && uv pip install openhands-ai");
        binaryPath = "/home/daytona/.openhands-venv/bin/openhands";
      } catch (e) {
        console.warn("[Worker] OpenHands installation failed, attempting system-wide fallback...");
        try {
          await runCommand("uv pip install --system openhands-ai --python 3.12");
          binaryPath = execSync(`${ROBUST_PATH} && which openhands`, { shell: true }).toString().trim();
        } catch (e2) {
          console.warn("[Worker] System installation failed, using 'uv run openhands'");
          binaryPath = "uv run openhands";
        }
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
    await runOpenHands(binaryPath);

    await sendUpdate("progress", { message: "🔗 Launching preview..." });
    try { execSync("fuser -k 3000/tcp 2>/dev/null || pkill -f \"vite\" 2>/dev/null || true"); } catch (e) {}
    await runCommand("nohup npx vite --host 0.0.0.0 --port 3000 > /home/daytona/dev-server.log 2>&1 &", { cwd: projectDir });

    await sendUpdate("complete", { 
      message: "Build complete! 🎉", 
      metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL, engine: "openhands" } 
    });
  } catch (err) {
    console.error("[Worker] Fatal error:", err);
    await sendUpdate("error", { message: "Error: " + err.message });
    process.exit(1);
  }
}

async function runOpenHands(cmdPath) {
  const env = { 
    ...process.env, 
    LLM_API_KEY: OPENROUTER_API_KEY, 
    LLM_BASE_URL: "https://openrouter.ai/api/v1", 
    LLM_MODEL: "openrouter/" + MODEL,
    PYTHONUNBUFFERED: "1"
  };
  
  const escapedPrompt = PROMPT.replace(/"/g, '\\"');
  
  // Use venv absolute path if it exists
  let command;
  if (cmdPath.includes(".openhands-venv")) {
    const venvPython = "/home/daytona/.openhands-venv/bin/python3";
    const absoluteOhPath = "/home/daytona/.openhands-venv/bin/openhands";
    // We execute via the venv's python3 explicitly to avoid shebang path issues (Exit 127)
    command = `${ROBUST_PATH} && ${venvPython} -m openhands.core.main --headless -t "${escapedPrompt}" || ${venvPython} ${absoluteOhPath} --headless -t "${escapedPrompt}"`;
  } else {
    command = `${ROBUST_PATH} && ${cmdPath} --headless -t "${escapedPrompt}"`;
  }

  console.log(`[Worker] Running Agent with command: ${command}`);

  return new Promise((resolve, reject) => {
    const cp = spawn("/bin/sh", ["-c", command], { env, cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
    cp.stdout.on("data", (data) => {
      const output = data.toString();
      process.stdout.write(output);
      const lower = output.toLowerCase();
      if (lower.includes("action")) sendUpdate("progress", { message: "Agent acting..." });
      if (lower.includes("thought")) sendUpdate("progress", { message: "Agent thinking..." });
    });
    cp.stderr.on("data", (data) => { process.stderr.write(data.toString()); });
    cp.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent exit ${code}. Check logs for details.`));
    });
  });
}

main();
