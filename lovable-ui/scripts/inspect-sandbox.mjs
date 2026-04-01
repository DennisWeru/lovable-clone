import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;

async function inspect() {
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });
  const sandboxId = "2d9e3d75-e5ba-4dd6-be5d-7431c011fbcb";
  
  try {
    const sandbox = await daytona.get(sandboxId);
    console.log(`🔍 Inspecting Sandbox: ${sandboxId}`);
    
    console.log("--- Process List ---");
    const ps = await sandbox.process.executeCommand("ps aux | grep -v 'ps aux'", "/home/daytona");
    console.log(ps.result);
    
    console.log("--- Disk Usage ---");
    const df = await sandbox.process.executeCommand("df -h /", "/home/daytona");
    console.log(df.result);

    console.log("--- Last 20 lines of worker.log (if it exists) ---");
    const logs = await sandbox.process.executeCommand("tail -n 20 /home/daytona/worker.log || echo 'No log file'", "/home/daytona");
    console.log(logs.result);

    console.log("--- Check if website-project has files ---");
    const ls = await sandbox.process.executeCommand("ls -R /home/daytona/website-project", "/home/daytona");
    console.log(ls.result);

  } catch (e) {
    console.error("Error inspecting:", e.message);
  }
}

inspect();
