import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const GENERATION_COST = 100;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error("[API] Auth error:", authError);
    }

    if (!user) {
      console.error("[API] No user found in session");
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in to generate code." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[API] User authenticated:", user.id);

    // Use admin client to bypass RLS for profile check
    const supabaseAdmin = createAdminClient();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[API] Profile fetch error for user", user.id, ":", profileError);
      return new Response(
        JSON.stringify({ error: "Could not fetch user profile", details: profileError?.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (profile.credits < GENERATION_COST) {
      return new Response(
        JSON.stringify({ error: `Insufficient credits. You need ${GENERATION_COST} credits to generate an app.` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const { prompt, model, sandboxId: existingSandboxId } = await req.json();
    
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const isGemini = model?.startsWith("gemini");
    const isClaude = model?.startsWith("claude");

    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Daytona API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (isClaude && !process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Anthropic API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (isGemini && !process.env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Gemini API key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[API] Starting Daytona generation for ${existingSandboxId || 'new sandbox'} using ${model}:`, prompt);

    // Deduct credits early using admin client
    const { error: deductError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits - GENERATION_COST })
      .eq("id", user.id);

    if (deductError) {
      return new Response(
        JSON.stringify({ error: "Failed to deduct credits securely. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create a record in projects table with 'pending' status using admin client to bypass RLS issues
    const { data: projectRecord, error: projectError } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: user.id,
        prompt: prompt,
        model: model || "gemini-2.5-flash",
        status: "pending",
        sandbox_id: existingSandboxId
      })
      .select()
      .single();

    if (projectError) {
      console.error("[API] Failed to create project record:", projectError);
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    // Start the async generation
    (async () => {
      try {
        // Use the generate-in-daytona.ts script
        const scriptPath = path.join(process.cwd(), "scripts", "generate-in-daytona.ts");
        
        // Pass sandboxId if available
        const args = existingSandboxId 
          ? [scriptPath, existingSandboxId, prompt, model]
          : [scriptPath, prompt, model];

        const child = spawn("npx", ["tsx", ...args], {
          env: {
            ...process.env,
            DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
          },
        });
        
        let sandboxId = "";
        let previewUrl = "";
        let buffer = "";
        
        // Capture stdout
        child.stdout.on("data", async (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            // Parse Claude messages
            if (line.includes('__CLAUDE_MESSAGE__')) {
              const jsonStart = line.indexOf('__CLAUDE_MESSAGE__') + '__CLAUDE_MESSAGE__'.length;
              try {
                const message = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "claude_message", 
                    content: message.content 
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse tool uses
            else if (line.includes('__TOOL_USE__')) {
              const jsonStart = line.indexOf('__TOOL_USE__') + '__TOOL_USE__'.length;
              try {
                const toolUse = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "tool_use", 
                    name: toolUse.name,
                    input: toolUse.input 
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse tool results
            else if (line.includes('__TOOL_RESULT__')) {
              // Skip tool results for now to reduce noise
              continue;
            }
            // Regular progress messages
            else {
              const output = line.trim();
              
              // Filter out internal logs
              if (output && 
                  !output.includes('[Claude]:') && 
                  !output.includes('[Tool]:') &&
                  !output.includes('__')) {
                
                // Send as progress
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "progress", 
                    message: output 
                  })}\n\n`)
                );
                
                // Extract sandbox ID
                const sandboxMatch = output.match(/Sandbox created: ([a-f0-9-]+)/);
                if (sandboxMatch) {
                  sandboxId = sandboxMatch[1];
                }
                
                // Extract preview URL
                const previewMatch = output.match(/Preview URL: (https:\/\/[^\s]+)/);
                if (previewMatch) {
                  previewUrl = previewMatch[1];
                }
              }
            }
          }
        });
        
        // Capture stderr
        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Daytona Error]:", error);
          
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
        
        // Send completion with preview URL
        if (previewUrl) {
          // Update the database with completion using admin client
          if (projectRecord) {
            await supabaseAdmin
              .from("projects")
              .update({
                sandbox_id: sandboxId,
                preview_url: previewUrl,
                status: "completed"
              })
              .eq("id", projectRecord.id);
          }

          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ 
              type: "complete", 
              sandboxId,
              previewUrl 
            })}\n\n`)
          );
          console.log(`[API] Generation complete. Preview URL: ${previewUrl}`);
        } else {
          throw new Error("Failed to get preview URL");
        }
        
        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during generation:", error);

        // Update project status to failed
        if (projectRecord) {
          await supabaseAdmin
            .from("projects")
            .update({ status: "failed" })
            .eq("id", projectRecord.id);

          // Optionally refund credits here
          /*
          const { data: currentProfile } = await supabase.from("profiles").select("credits").eq("id", user.id).single();
          if (currentProfile) {
            await supabase.from("profiles").update({ credits: currentProfile.credits + GENERATION_COST }).eq("id", user.id);
          }
          */
        }

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