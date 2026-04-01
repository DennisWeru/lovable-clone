import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from 'url';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars from project root
dotenv.config({ path: path.join(__dirname, "../.env") });

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;

if (!DAYTONA_API_KEY) {
  console.error("❌ Missing DAYTONA_API_KEY in .env");
  process.exit(1);
}

async function cleanup() {
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  try {
    console.log("🔍 Listing all sandboxes...");
    const result = await daytona.list();
    const items = result.items;
    console.log(`Found ${items.length} sandboxes.`);

    for (const sandbox of items) {
      console.log(`🧹 Deleting sandbox: ${sandbox.id} (${sandbox.image || "no image"})...`);
      try {
        await daytona.delete(sandbox);
        console.log(`✅ Deleted ${sandbox.id}`);
      } catch (e) {
        console.error(`❌ Failed to delete ${sandbox.id}: ${e.message}`);
      }
    }
    console.log("✨ Cleanup complete!");
  } catch (error) {
    console.error("❌ Error during cleanup:", error.message);
  }
}

cleanup();
