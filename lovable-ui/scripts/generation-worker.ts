import { execSync } from "child_process";

// 1. Bootstrapping
console.log("[Worker] Bootstrapping dependencies...");
try {
  execSync("npm install @google/generative-ai", { stdio: "inherit" });
} catch (e) {
  console.error("[Worker] Bootstrap failed:", e);
}

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

// 2. Inputs from Environment/CLI
const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "gemini-1.5-flash";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";
const IS_FOLLOW_UP = process.env.IS_FOLLOW_UP === "true";
const CONVERSATION_HISTORY = process.env.CONVERSATION_HISTORY || "";

async function sendUpdate(type: string, data: any) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  try {
    const payload = {
      projectId: PROJECT_ID,
      token: WEBHOOK_TOKEN,
      type,
      ...data
    };
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error(`[Worker] Failed to send update (${type}):`, e);
  }
}

async function run() {
  await sendUpdate("progress", { message: "🚀 Worker started inside Daytona sandbox..." });

  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
    if (!PROMPT) throw new Error("PROMPT is missing");

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL });

    const projectDir = path.join(process.cwd(), "website-project");
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    let projectContext = "";
    if (IS_FOLLOW_UP) {
      await sendUpdate("progress", { message: "2. Detecting existing context..." });
      // In a real worker, we would scan the files here.
      // For now, assume isFollowUp is handled by Vercel passing history.
      projectContext = `
      You are MODIFYING an existing project.
      ${CONVERSATION_HISTORY ? `\nHistory:\n${CONVERSATION_HISTORY}` : ""}
      `;
    }

    const formattedPrompt = `
      ${projectContext}
      User Request: ${PROMPT}
      Technical Requirements:
      - Use NextJS (App Router), TypeScript, and Tailwind CSS.
      - Output ONLY a valid JSON object:
      { "files": [{ "path": "string", "content": "string" }], "commands": ["string"] }
    `;

    await sendUpdate("progress", { message: "3. Generating content with AI..." });
    const result = await model.generateContent(formattedPrompt);
    const response = result.response;
    const text = response.text();

    let parsed;
    try {
      // Clean markdown code blocks if necessary
      const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      throw new Error("Failed to parse AI response as JSON: " + text.slice(0, 100));
    }

    // Write Files
    if (parsed.files && Array.isArray(parsed.files)) {
      for (const file of parsed.files) {
        const filePath = path.join(projectDir, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, file.content);
        await sendUpdate("tool_use", { name: "WriteFile", input: { path: file.path } });
      }
    }

    // Run Commands (Simplified for worker execution)
    if (parsed.commands && Array.isArray(parsed.commands)) {
      for (const cmd of parsed.commands) {
        await sendUpdate("tool_use", { name: "RunCommand", input: { command: cmd } });
        // In a real implementation, you'd use execSync or spawn.
        // For standard "npm install", it's safer to handle explicitly outside AI commands.
      }
    }

    await sendUpdate("progress", { message: "4. Finalizing and starting server..." });

    // In a real sandbox, we would run npm install here.
    // We already do this in the current Daytona integration, 
    // but the worker could handle it to be truly standalone.

    await sendUpdate("complete", { 
      message: "Generation complete!",
      metadata: {
        sandboxId: SANDBOX_ID,
        previewUrl: `https://${SANDBOX_ID}.daytona.app`
      }
    });

  } catch (error: any) {
    await sendUpdate("error", { message: error.message });
    process.exit(1);
  }
}

run();
