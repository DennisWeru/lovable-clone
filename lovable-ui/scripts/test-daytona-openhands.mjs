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

    console.log("📤 Uploading test environment...");
    const testPrompt = "Create a simple landing page for a coffee shop with a hero section and a menu.";
    const envFileContent = Object.entries({
      GENERATION_PROMPT: testPrompt,
      GENERATION_MODEL: "google/gemini-2.0-flash-001",
      PROJECT_ID: "test-project-" + Date.now(),
      WEBHOOK_TOKEN: "test-token",
      WEBHOOK_URL: "", // No webhook for local test
      OPENROUTER_API_KEY: OPENROUTER_API_KEY || "",
      SANDBOX_ID: sandbox.id,
      PREVIEW_URL: `https://${sandbox.id}.daytona.app`,
    }).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("\n");

    await sandbox.fs.uploadFile(Buffer.from(envFileContent), "/home/daytona/worker-env.sh");

    console.log("🐝 Executing OpenHands worker in sandbox...");
    
    // Execute and wait for result
    const result = await sandbox.process.executeCommand(
      `source /home/daytona/worker-env.sh && node ${remoteWorkerPath}`,
      "/home/daytona",
      undefined,
      1200000 // 20 minute timeout for installation
    );

    console.log("\n--- SANDBOX OUTPUT ---");
    console.log(result.result || "No output");
    console.log("--- END OUTPUT ---\n");

    if (result.exitCode === 0) {
      console.log("✨ SUCCESS! OpenHands completed successfully.");
    } else {
      console.error(`❌ FAILED! Worker exited with code ${result.exitCode}`);
      // Try to read the logs if it failed
      try {
        const logs = await sandbox.process.executeCommand("cat /home/daytona/worker.log", "/home/daytona");
        console.log("\n--- WORKER.LOG ---");
        console.log(logs.result);
      } catch (e) {}
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
