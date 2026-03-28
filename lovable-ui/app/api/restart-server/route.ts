import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[API] Critical: Missing Supabase Environment Variables");
      return NextResponse.json(
        { error: "Server configuration error: Missing Supabase keys" },
        { status: 500 }
      );
    }

    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in to restart server." },
        { status: 401 }
      );
    }

    const { sandboxId, projectId } = await req.json();

    if (!sandboxId) {
      return NextResponse.json(
        { error: "Sandbox ID is required" },
        { status: 400 }
      );
    }

    // Verify ownership
    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .single();

      if (projectError || !project || project.user_id !== user.id) {
        return NextResponse.json(
          { error: "Forbidden. You do not own this project." },
          { status: 403 }
        );
      }
    }

    if (!process.env.DAYTONA_API_KEY) {
      return NextResponse.json(
        { error: "Missing Daytona API key" },
        { status: 500 }
      );
    }

    console.log(`[API] Restarting server for sandbox ${sandboxId} for user ${user.id}`);

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        const scriptPath = path.join(process.cwd(), "scripts", "start-dev-server.ts");

        // spawn might fail on Vercel serverless environment
        const child = spawn("npx", ["tsx", scriptPath, sandboxId], {
          env: {
            ...process.env,
            DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
          },
        });

        let previewUrl = "";

        child.stdout.on("data", async (data) => {
          const output = data.toString().trim();
          if (output) {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ type: "progress", message: output })}\n\n`)
            );

            const previewMatch = output.match(/Preview URL:\s*(https:\/\/[^\s]+)/);
            if (previewMatch) previewUrl = previewMatch[1];
          }
        });

        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Restart Error]:", error);

          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: error.trim() })}\n\n`)
          );
        });

        await new Promise((resolve, reject) => {
          child.on("exit", (code) => {
            if (code === 0) resolve(code);
            else reject(new Error(`Process exited with code ${code}. This usually fails in Vercel Serverless environments.`));
          });
          child.on("error", reject);
        });

        if (previewUrl) {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ type: "complete", previewUrl })}\n\n`)
          );
        } else {
          throw new Error("Failed to get preview URL after server restart");
        }

        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during restart:", error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`)
        );
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (error: any) {
    console.error("[API] Top-level Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}