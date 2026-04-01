import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from 'url';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars from project root
dotenv.config({ path: path.join(__dirname, "../.env") });

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!DAYTONA_API_KEY || !OPENROUTER_API_KEY) {
  console.error("❌ Missing DAYTONA_API_KEY or OPENROUTER_API_KEY in .env");
  process.exit(1);
}

const workerPath = path.join(__dirname, "../app/api/generate-daytona/worker.mjs");
if (!fs.existsSync(workerPath)) {
    console.error(`❌ Worker script not found at ${workerPath}`);
    process.exit(1);
}
const workerContent = fs.readFileSync(workerPath, "utf8");

async function runTest() {
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  let sandbox = null;

  try {
    console.log("🚀 Creating test Daytona sandbox...");
    sandbox = await daytona.create({
      public: true,
      image: "mcr.microsoft.com/playwright:v1.49.0-noble",
      resources: { cpu: 2, memory: 4, disk: 5 },
      autoStopInterval: 30 // 30 minutes
    });

    console.log(`✅ Sandbox created: ${sandbox.id}`);

    // Debug: check disk usage
    const df1 = await sandbox.process.executeCommand("df -h", "/home/daytona");
    console.log("Initial disk usage:\n", df1.result);

    console.log("📤 Uploading worker script...");
    const remoteWorkerPath = "/home/daytona/generation-worker.mjs";
    await sandbox.fs.uploadFile(Buffer.from(workerContent), remoteWorkerPath);

    // Upload Python SDK runner
    const runnerPath = path.join(__dirname, "../app/api/generate-daytona/agent_runner.py");
    const runnerContent = fs.readFileSync(runnerPath, "utf8");
    await sandbox.fs.uploadFile(Buffer.from(runnerContent), "/home/daytona/agent_runner.py");

    console.log("📤 Uploading test environment...");
    const testPrompt = "Generate a modern landing page for a coffee shop in the current directory. Use `npm create vite@latest . -- --template react --no-interactive` to start. Ensure you use Tailwind CSS, Lucide React icons, and follow the premium aesthetic rules in CLAUDE.md.";
    const envFileContent = Object.entries({
      GENERATION_PROMPT: testPrompt,
      GENERATION_MODEL: "google/gemini-2.0-flash-001",
      PROJECT_ID: "test-project-" + Date.now(),
      WEBHOOK_TOKEN: "test-token",
      WEBHOOK_URL: "", 
      OPENROUTER_API_KEY: OPENROUTER_API_KEY || "",
      SANDBOX_ID: sandbox.id,
      PREVIEW_URL: `https://${sandbox.id}.daytona.app`,
      GAI_STRATEGY: "inet",
      PYTHONUNBUFFERED: "1"
    }).map(([k, v]) => {
      // Escape backticks and dollar signs for bash double quotes
      const escapedValue = JSON.stringify(v).replace(/`/g, "\\`").replace(/\$/g, "\\$");
      return `export ${k}=${escapedValue}`;
    }).join("\n");

    await sandbox.fs.uploadFile(Buffer.from(envFileContent), "/home/daytona/worker-env.sh");

    console.log("🐝 Executing OpenHands worker in sandbox (Streaming Logs)...");
    
    // Create PTY for real-time log streaming
    const ptyHandle = await sandbox.process.createPty({
      id: "test-session-" + Date.now(),
      cwd: "/home/daytona",
      cols: 120,
      rows: 40,
      onData: (data) => {
        process.stdout.write(new TextDecoder().decode(data));
      },
    });

    await ptyHandle.waitForConnection();
    await ptyHandle.sendInput(`source /home/daytona/worker-env.sh && node ${remoteWorkerPath}\n`);

    // Wait for the process to complete
    const result = await ptyHandle.wait();

    console.log("\n--- EXECUTION FINISHED ---");

    if (result.exitCode === 0) {
      console.log("✨ SUCCESS! OpenHands completed successfully.");
    } else {
      console.error(`❌ FAILED! Worker exited with code ${result.exitCode}`);
    }

  } catch (error) {
    console.error("❌ Error during test:", error);
  } finally {
    if (sandbox) {
      console.log(`🧹 Deleting sandbox ${sandbox.id} to save credits...`);
      try {
        await daytona.delete(sandbox);
        console.log("✅ Sandbox deleted.");
      } catch (e) {
        console.error(`❌ Failed to delete sandbox: ${e.message}`);
      }
    }
  }
}

runTest();
