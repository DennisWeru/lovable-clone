import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in to restart server." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { sandboxId } = await req.json();

    if (!sandboxId) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Daytona API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[API] Restarting server for sandbox ${sandboxId} for user ${user.id}`);

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start the async restart process
    (async () => {
      try {
        const scriptPath = path.join(process.cwd(), "scripts", "start-dev-server.ts");

        const child = spawn("npx", ["tsx", scriptPath, sandboxId], {
          env: {
            ...process.env,
            DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
          },
        });

        let previewUrl = "";

        // Capture stdout
        child.stdout.on("data", async (data) => {
          const output = data.toString().trim();
          if (output) {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({
                type: "progress",
                message: output
              })}\n\n`)
            );

            // Extract preview URL
            const previewMatch = output.match(/Preview URL:\s*(https:\/\/[^\s]+)/);
            if (previewMatch) {
              previewUrl = previewMatch[1];
            }
          }
        });

        // Capture stderr
        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Restart Error]:", error);

          await writer.write(
            encoder.encode(`data: ${JSON.stringify({
              type: "error",
              message: error.trim()
            })}\n\n`)
          );
        });

        // Wait for process to complete
        await new Promise((resolve, reject) => {
          child.on("exit", (code) => {
            if (code === 0) {
              resolve(code);
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });

          child.on("error", reject);
        });

        if (previewUrl) {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({
              type: "complete",
              previewUrl
            })}\n\n`)
          );
        } else {
          throw new Error("Failed to get preview URL");
        }

        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during restart:", error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({
            type: "error",
            message: error.message
          })}\n\n`)
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
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}