import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Daytona } from "@daytonaio/sdk";

export const maxDuration = 60; 

export async function GET() {
  return NextResponse.json({
    status: "ok",
    hasDaytona: !!Daytona,
    nodeVersion: process.version,
    env: {
      hasDaytonaKey: !!process.env.DAYTONA_API_KEY,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt } = body;
    
    if (!prompt) return NextResponse.json({ error: "No prompt" }, { status: 400 });

    // Minimal Test: Just return success without calls
    return NextResponse.json({
      success: true,
      message: "Test API call reached!",
      uuid: crypto.randomUUID(), // Global crypto
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}