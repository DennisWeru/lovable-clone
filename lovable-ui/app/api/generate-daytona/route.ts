import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Daytona } from "@daytonaio/sdk";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const maxDuration = 60; // Keep within Hobby limit, but we return in < 5s anyway

const GENERATION_COST = 100;

export async function POST(req: NextRequest) {
  try {
    // 1. Basic Environment Check
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[API] Critical: Missing Supabase Environment Variables");
      return NextResponse.json(
        { error: "Server configuration error: Missing Supabase keys" },
        { status: 500 }
      );
    }

    if (!process.env.DAYTONA_API_KEY || !process.env.GEMINI_API_KEY) {
       return NextResponse.json(
        { error: "Server configuration error: Missing AI or Daytona API keys" },
        { status: 500 }
      );
    }

    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;

    if (authError || !user) {
      console.error("[API] Auth error or No user:", authError);
      return NextResponse.json(
        { error: "Unauthorized. Please log in to generate code." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createAdminClient();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Could not fetch user profile" }, { status: 500 });
    }

    if (profile.credits < GENERATION_COST) {
      return NextResponse.json({ error: `Insufficient credits. Need ${GENERATION_COST}.` }, { status: 403 });
    }

    const { prompt, model, sandboxId: existingSandboxId } = await req.json();
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    // Generate Secure Webhook Token
    const webhookToken = crypto.randomUUID();

    // Deduct credits and Create project record
    const { data: projectRecord, error: projectError } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: user.id,
        prompt: prompt,
        model: model || "gemini-1.5-flash",
        status: "pending",
        sandbox_id: existingSandboxId,
        webhook_token: webhookToken
      })
      .select()
      .single();

    if (projectError || !projectRecord) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits - GENERATION_COST })
      .eq("id", user.id);

    // Daytona Setup (Fast part)
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    let sandbox;
    let sandboxId = existingSandboxId;

    if (sandboxId) {
      const sandboxes = await daytona.list();
      sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    }

    if (!sandbox) {
      sandbox = await daytona.create({ public: true, image: "node:20" });
      sandboxId = sandbox.id;
    }

    // Upload the worker script (detaching the work)
    const workerPath = "scripts/generation-worker.ts";
    const workerContent = await fs.promises.readFile(path.join(process.cwd(), workerPath), "utf-8");
    
    // We execute the worker using tsx, ensuring it handles everything
    await sandbox.process.executeCommand(`mkdir -p scripts`, "/home/daytona");
    const base64Worker = Buffer.from(workerContent).toString("base64");
    await sandbox.process.executeCommand(
       `echo "${base64Worker}" | base64 -d > "/home/daytona/${workerPath}"`,
       "/home/daytona"
    );

    // Determine absolute webhook URL
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = req.headers.get("host") || "localhost:3000";
    let webhookUrl = `${protocol}://${host}/api/webhooks/daytona-progress`;

    // Support override for local development tunnels (ngrok, etc.)
    if (process.env.WEBHOOK_BASE_URL) {
      webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/daytona-progress`;
    }

    // DETACH: Run in background with nohup
    const env = {
       GENERATION_PROMPT: prompt,
       GENERATION_MODEL: model || "gemini-1.5-flash",
       PROJECT_ID: projectRecord.id,
       WEBHOOK_TOKEN: webhookToken,
       WEBHOOK_URL: webhookUrl,
       GEMINI_API_KEY: process.env.GEMINI_API_KEY,
       SANDBOX_ID: sandboxId,
       IS_FOLLOW_UP: existingSandboxId ? "true" : "false"
    };

    const envString = Object.entries(env).map(([k, v]) => `${k}="${v}"`).join(" ");
    
    // Background execution
    sandbox.process.executeCommand(
       `nohup npx -y tsx scripts/generation-worker.ts > worker.log 2>&1 &`,
       "/home/daytona",
       env
    ).catch(e => console.error("[API] Detached execution failed trigger:", e));

    // Return IMMEDIATELY (Vercel sees < 2s duration)
    return NextResponse.json({
       success: true,
       projectId: projectRecord.id,
       sandboxId: sandboxId,
       status: "started"
    });

  } catch (error: any) {
    console.error("[API] Top-level error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}