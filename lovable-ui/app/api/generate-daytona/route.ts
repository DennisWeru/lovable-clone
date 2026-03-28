import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60; 

export async function GET() {
  try {
    const { Daytona } = await import("@daytonaio/sdk");
    return NextResponse.json({
      status: "ok",
      hasDaytona: !!Daytona,
      nodeVersion: process.version,
      env: {
        hasDaytonaKey: !!process.env.DAYTONA_API_KEY,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      }
    });
  } catch (err: any) {
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
    
    // 3. Auth & Environment
    const supabaseAdmin = createAdminClient();
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userRole = authData?.user?.id || "anonymous";

    if (!process.env.DAYTONA_API_KEY || !process.env.GEMINI_API_KEY) {
      console.error("[API] Missing API Keys");
      return NextResponse.json({ error: "Server Configuration Error: API Keys missing" }, { status: 500 });
    }

    const webhookToken = crypto.randomUUID();

    // 4. Database Project Record
    let projectRecord;
    if (projectId) {
      console.log("[API] Updating project:", projectId);
      const { data, error } = await supabaseAdmin
        .from("projects")
        .update({ webhook_token: webhookToken })
        .eq("id", projectId)
        .select()
        .single();
      if (error) throw new Error(`DB Update Error: ${error.message}`);
      projectRecord = data;
    } else {
      console.log("[API] Inserting new project...");
      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({
          name: prompt.split(" ").slice(0, 5).join(" "),
          prompt: prompt,
          model: model || "gemini-1.5-flash",
          user_id: userRole,
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
        const sandboxes = await daytona.list();
        sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      }
      
      if (!sandbox) {
        console.log("[API] Creating sandbox...");
        sandbox = await daytona.create({ 
          public: true, 
          image: "node:20"
        });
        sandboxId = sandbox.id;
      }
    } catch (e: any) {
      console.error("[API] Daytona error:", e);
      throw new Error(`Daytona sandbox failed: ${e.message}`);
    }

    // 6. Worker Payload (Bundled)
    const workerContent = `
import { execSync } from "child_process";
console.log("[Worker] Bootstrapping...");
try { execSync("npm install @google/generative-ai", { stdio: "inherit" }); } catch (e) { console.error(e); }

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

const PROMPT = process.env.GENERATION_PROMPT || "";
const MODEL = process.env.GENERATION_MODEL || "gemini-1.5-flash";
const PROJECT_ID = process.env.PROJECT_ID || "";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SANDBOX_ID = process.env.SANDBOX_ID || "";

async function sendUpdate(type, data) {
  if (!WEBHOOK_URL || !WEBHOOK_TOKEN) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, token: WEBHOOK_TOKEN, type, ...data })
    });
  } catch (e) { console.error(e); }
}

async function run() {
  await sendUpdate("progress", { message: "🚀 Worker started..." });
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL });
    const projectDir = path.join(process.cwd(), "website-project");
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

    const result = await model.generateContent(PROMPT);
    const text = result.response.text();
    const tripleBacktick = String.fromCharCode(96, 96, 96);
    const cleanJson = text.split(tripleBacktick + "json").pop().split(tripleBacktick).shift().trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed.files) {
      for (const file of parsed.files) {
        const filePath = path.join(projectDir, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, file.content);
        await sendUpdate("tool_use", { name: "WriteFile", input: { path: file.path } });
      }
    }
    await sendUpdate("complete", { message: "Success!", metadata: { sandboxId: SANDBOX_ID, previewUrl: "https://" + SANDBOX_ID + ".daytona.app" } });
  } catch (e) {
    await sendUpdate("error", { message: e.message });
  }
}
run();
`;

    // 7. Execute in Sandbox
    const workerPath = "/home/daytona/scripts/generation-worker.ts";
    await sandbox.process.executeCommand("mkdir -p /home/daytona/scripts", "/home/daytona");
    const base64Worker = Buffer.from(workerContent).toString("base64");
    await sandbox.process.executeCommand(`echo "${base64Worker}" | base64 -d > ${workerPath}`, "/home/daytona");

    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = req.headers.get("host") || "localhost:3000";
    let webhookUrl = `${protocol}://${host}/api/webhooks/daytona-progress`;
    if (process.env.WEBHOOK_BASE_URL) webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`;

    const env = {
       GENERATION_PROMPT: prompt,
       GENERATION_MODEL: model || "gemini-1.5-flash",
       PROJECT_ID: projectRecord.id,
       WEBHOOK_TOKEN: webhookToken,
       WEBHOOK_URL: webhookUrl,
       GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
       SANDBOX_ID: sandboxId,
    };

    sandbox.process.executeCommand(
       `nohup npx -y tsx ${workerPath} > /home/daytona/worker.log 2>&1 &`,
       "/home/daytona",
       env
    ).catch(e => console.error("[API] Detach failed:", e));

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