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
const IS_RESUME = process.env.IS_RESUME === "true";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

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
  const interval = setInterval(async () => {
    if (Date.now() - lastUpdateAt > 20000) {
      const msg = FRIENDLY_MESSAGES[currentFriendlyIndex];
      currentFriendlyIndex = (currentFriendlyIndex + 1) % FRIENDLY_MESSAGES.length;
      await sendUpdate("progress", { message: "✨ " + msg });
    }
  }, 20000);
  return interval;
}

function findPackageJson(dir, depth = 0) {
  if (depth > 1) return null;
  try {
    const files = fs.readdirSync(dir);
    if (files.includes("package.json")) return dir;
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory() && !file.startsWith(".") && file !== "node_modules") {
        const found = findPackageJson(fullPath, depth + 1);
        if (found) return found;
      }
    }
  } catch (e) { }
  return null;
}

function flattenProject(sourceDir, targetDir) {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return;
  console.log(`[Worker] Flattening project from ${sourceDir} to ${targetDir}...`);
  try {
    // Move all files including hidden ones using bash shell
    execSync(`bash -c "shopt -s dotglob && mv ${sourceDir}/* ${targetDir}/"`);
    // Remove the now empty subdirectory
    if (fs.readdirSync(sourceDir).length === 0) {
      fs.rmdirSync(sourceDir);
    }
  } catch (e) {
    console.warn("[Worker] Flattening encountered issues (some files may already exist):", e.message);
  }
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

    const friendlyInterval = startFriendlyRotation();
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
        await sendUpdate("progress", { message: "📦 Installing OpenHands SDK 1.16.0 (this may take a minute)..." });
        await runCommand(". /home/daytona/.openhands-venv/bin/activate && uv pip install openhands-sdk==1.16.0 openhands-tools");
      } catch (e) {
        console.error("[Worker] OpenHands installation failed.", e);
        throw new Error("Failed to prepare OpenHands environment. Please try again.");
      }
    }

    // 0.5 Restore from backup if this is a resume and directory is empty
    if (IS_RESUME) {
      const files = fs.readdirSync(projectDir);
      if (files.length === 0 || (files.length === 1 && files[0] === ".DS_Store")) {
        await sendUpdate("progress", { message: "📦 Recovering project files from cloud storage..." });
        await restoreProject();
      }
    }

    const rules = [
      "# Lovabee Agent Rules",
      "- Tech: React, Vite, Tailwind CSS",
      "- STYLE: ALWAYS use Vite for new projects. DO NOT use create-react-app.",
      "- WORKSPACE: Always initialize the project in the CURRENT directory (`./`).",
      "- Tech Structure: Use Lucide React for icons.",
      "- Styling: Premium modern aesthetics (gradients, glassmorphism, Inter font).",
      "- Port: 3000 (Required for preview).",
      "- CORE MEMORY: ALWAYS maintain a `decisions.md` file. Document every major architectural choice, dependency added, and feature implemented. Read this file at the start of every session to maintain continuity."
    ].join("\n");
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), rules);
    
    // Ensure decisions.md exists
    const decisionsPath = path.join(projectDir, "decisions.md");
    if (!fs.existsSync(decisionsPath)) {
      fs.writeFileSync(decisionsPath, "# Project Decisions\n\n- Initial project creation\n");
    }

    await sendUpdate("progress", { message: "🐝 Lovabee AI is planning your website..." });
    await runAgentSDK(venvBin);

    // 1. Recursive Project Validation & Flattening
    const foundDir = findPackageJson(projectDir);
    if (!foundDir) {
      console.error("[Worker] Agent finished but package.json was not found. Generation likely failed.");
      await sendUpdate("error", { message: "Agent failed to generate the website files (no package.json found). Please check your prompt." });
      clearInterval(friendlyInterval);
      process.exit(1);
    }

    if (path.resolve(foundDir) !== path.resolve(projectDir)) {
      console.log(`[Worker] Project detected in subdirectory: ${foundDir}. Flattening...`);
      await sendUpdate("progress", { message: "🪄 Finalizing project structure..." });
      flattenProject(foundDir, projectDir);
    }

    // 2. Dynamic Dev Server Detection
    await sendUpdate("progress", { message: "🔗 Launching preview..." });
    let devCommand = "npx vite --host 0.0.0.0 --port 3000";
    
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
      if (pkg.scripts?.dev) {
        if (pkg.scripts.dev.includes("next")) {
          devCommand = "npx next dev --port 3000 --hostname 0.0.0.0";
        } else if (pkg.scripts.dev.includes("vite")) {
          devCommand = "npx vite --host 0.0.0.0 --port 3000";
        } else {
          devCommand = "npm run dev -- --port 3000 --host 0.0.0.0 --hostname 0.0.0.0";
        }
      }
    } catch (e) {
       console.warn("[Worker] Could not parse package.json for dev scripts, using fallback.");
    }

    try { execSync("fuser -k 3000/tcp 2>/dev/null || pkill -f \"vite|next\" 2>/dev/null || true"); } catch (e) {}
    await runCommand(`nohup ${devCommand} > /home/daytona/dev-server.log 2>&1 &`, { cwd: projectDir });

    // 3. Backup to Supabase
    await sendUpdate("progress", { message: "Backing up... 📦 Securing backup to cloud storage..." });
    await backupProject();

    await sendUpdate("complete", { 
      message: "Build complete! 🎉", 
      metadata: { sandboxId: SANDBOX_ID, previewUrl: PREVIEW_URL, engine: "openhands-sdk" } 
    });

    clearInterval(friendlyInterval);
    process.exit(0);
  } catch (err) {
    console.error("[Worker] Fatal error:", err);
    await sendUpdate("error", { message: "Error: " + err.message });
    process.exit(1);
  }
}

async function runAgentSDK(pythonPath) {
  let finalPrompt = PROMPT;
  if (IS_RESUME) {
    finalPrompt = `Here is the existing code and the decisions we made previously from decisions.md. Do not recreate it; just continue from where you left off or start dev server and wait for further instructions.\n\nOriginal Task: ${PROMPT}`;
  }

  const env = { 
    ...process.env, 
    LLM_API_KEY: OPENROUTER_API_KEY, 
    LLM_BASE_URL: "https://openrouter.ai/api/v1", 
    LLM_MODEL: MODEL,
    OPENHANDS_WORKSPACE_BASE: projectDir,
    OPENHANDS_SID: process.env.OPENHANDS_SID,
    GENERATION_PROMPT: finalPrompt, // Override with resumed prompt
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
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        
        try {
          const payload = JSON.parse(trimmed);
          // Update timestamp whenever we get ANY valid structured data from the agent
          lastUpdateAt = Date.now();

          if (payload.type === "progress" || payload.type === "status") {
             // Map 'status' to 'progress' for the UI
             sendUpdate("progress", { message: payload.message });
          } else if (payload.type === "tool_use") {
             sendUpdate("tool_use", { 
               name: payload.name, 
               input: payload.input,
               id: payload.id 
             });
          } else if (payload.type === "tool_result") {
             sendUpdate("tool_result", { 
               name: payload.name, 
               result: payload.result,
               ref_id: payload.ref_id 
             });
          } else if (payload.type === "error") {
             console.warn("[Runner Error]", payload.message);
             sendUpdate("error", { message: payload.message });
          } else if (payload.type === "complete") {
             // The runner might report completion via JSON too
             console.log("[Worker] Agent reported completion.");
          }
        } catch (e) {
          // Likely a partial JSON or interleaved logs, ignore and continue
        }
      }
    });

    cp.stderr.on("data", (data) => { process.stderr.write(data.toString()); });
    cp.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent SDK exit ${code}. Check runner logs.`));
    });
  });
}

async function restoreProject() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !PROJECT_ID) return;

  const archiveName = `${PROJECT_ID}.tar.gz`;
  const archivePath = `/home/daytona/${archiveName}`;
  const downloadUrl = `${SUPABASE_URL}/storage/v1/object/project-backups/${archiveName}`;

  try {
    console.log(`[Worker] Attempting to restore project from: ${archiveName}`);
    const res = await fetch(downloadUrl, {
      headers: { "Authorization": `Bearer ${SUPABASE_KEY}` }
    });

    if (!res.ok) {
      console.warn(`[Worker] No backup found for project ${PROJECT_ID} (Status: ${res.status}). Starting fresh.`);
      return;
    }

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(archivePath, Buffer.from(arrayBuffer));
    
    console.log(`[Worker] Extracting archive to ${projectDir}...`);
    execSync(`tar -xzf ${archivePath} -C ${projectDir}`);
    console.log(`[Worker] Project restoration complete.`);
  } catch (e) {
    console.error("[Worker] Restoration failed:", e.message);
  } finally {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  }
}

async function backupProject() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !PROJECT_ID) {
    console.warn("[Worker] Missing Supabase credentials, skipping backup.");
    return;
  }

  const archiveName = `${PROJECT_ID}.tar.gz`;
  const archivePath = `/home/daytona/${archiveName}`;
  
  try {
    console.log(`[Worker] Creating project archive: ${archiveName}`);
    // Exclude node_modules, .next, and other volatile directories for speed and reliability
    const excludeFlags = "--exclude='node_modules' --exclude='.next' --exclude='.openhands_state' --exclude='.uv-cache'";
    execSync(`tar -czf ${archivePath} ${excludeFlags} --ignore-failed-read -C ${projectDir} .`);
    
    const stats = fs.statSync(archivePath);
    console.log(`[Worker] Uploading archive (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
    
    const fileBuffer = fs.readFileSync(archivePath);
    const bucketUrl = `${SUPABASE_URL}/storage/v1/object/project-backups`;
    const uploadUrl = `${bucketUrl}/${archiveName}`;
    
    const res = await fetch(uploadUrl, {
      method: "POST", // Use POST for new or UPSERT via header
      headers: {
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/x-gzip",
        "x-upsert": "true"
      },
      body: fileBuffer
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[Worker] Backup upload failed: ${res.status} ${errorText}`);
    } else {
      console.log(`[Worker] Backup successfully uploaded to Supabase Storage.`);
    }
  } catch (e) {
    console.error("[Worker] Backup failed:", e.message);
  } finally {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  }
}

main();
