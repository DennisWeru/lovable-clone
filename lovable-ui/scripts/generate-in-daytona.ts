import { Daytona } from "@daytonaio/sdk";
import { query } from "@anthropic-ai/claude-code";
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function generateWebsiteInDaytona(
  sandboxIdArg?: string,
  prompt?: string,
  modelArg?: string
) {
  console.log("🚀 Starting website generation in Daytona sandbox...\n");

  const model = modelArg || "gemini-2.5-flash";
  const isClaude = model.startsWith("claude");
  const isGemini = model.startsWith("gemini");

  if (!process.env.DAYTONA_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY must be set");
    process.exit(1);
  }

  if (isClaude && !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY must be set for Claude models");
    process.exit(1);
  }

  if (isGemini && !process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY must be set for Gemini models");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  let sandbox;
  let sandboxId = sandboxIdArg;

  try {
    // Step 1: Create or get sandbox
    if (sandboxId) {
      console.log(`1. Using existing sandbox: ${sandboxId}`);
      // Get existing sandbox
      const sandboxes = await daytona.list();
      sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found`);
      }
      console.log(`✓ Connected to sandbox: ${sandbox.id}`);
    } else {
      console.log("1. Creating new Daytona sandbox...");
      sandbox = await daytona.create({
        public: true,
        image: "node:20",
      });
      sandboxId = sandbox.id;
      console.log(`✓ Sandbox created: ${sandboxId}`);
    }

    // Get the root directory
    const rootDir = await sandbox.getUserRootDir();
    console.log(`✓ Working directory: ${rootDir}`);
    const projectDir = `${rootDir}/website-project`;

    let projectContext = "";
    const isFollowUp = !!sandboxIdArg;

    if (isFollowUp) {
      console.log("\n2. Detecting existing project context and decisions log...");
      try {
        const lsResult = await sandbox.process.executeCommand("find . -maxdepth 3 -not -path '*/.*' -not -path '*/node_modules/*'", projectDir);
        const packageJson = await sandbox.process.executeCommand("cat package.json", projectDir);
        const decisionsLog = await sandbox.process.executeCommand("cat decisions_log.md", projectDir);
        
        const conversationHistory = process.env.CONVERSATION_HISTORY || "";

        projectContext = `
        You are MODIFYING an existing project.
        
        Existing file structure:
        ${lsResult.result || "Unknown"}
        
        Existing package.json:
        ${packageJson.result || "{}"}
        
        Previous Decisions Log (from decisions_log.md):
        ${decisionsLog.result || "No logs yet."}

        ${conversationHistory ? `Conversation History (most recent last):
        ${conversationHistory}` : ""}
        
        IMPORTANT: 
        1. Only provide the "files" that need to be created or modified to fulfill the new request.
        2. Do NOT provide unchanged files to save tokens and time.
        3. Only provide "commands" that are necessary for the modification (e.g. installing new packages). Do not run "npm install" if not needed.
        4. If you modify a file, provide its FULL content in the "files" array.
        5. You MUST append your current decisions and changes to "decisions_log.md" by including it in the "files" array with the updated content.
        6. Always run the build command to ensure there are no errors after modifications.
        `;
      } catch (e) {
        console.log("Could not read project context, falling back to full generation.");
      }
    } else {
      // Step 2: Create project directory
      console.log("\n2. Setting up project directory...");
      await sandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir);
      console.log(`✓ Created project directory: ${projectDir}`);

      // Step 3: Initialize npm project
      console.log("\n3. Initializing npm project...");
      await sandbox.process.executeCommand("npm init -y", projectDir);
      console.log("✓ Package.json created");

      // Step 4: Install AI SDK locally in project
      console.log("\n4. Installing AI SDK locally...");
      const installCmd = isClaude ? "npm install @anthropic-ai/claude-code@latest" : "npm install @google/generative-ai dotenv";
      const installResult = await sandbox.process.executeCommand(
        installCmd,
        projectDir,
        undefined,
        300000 // 5 minute timeout
      );

      if (installResult.exitCode !== 0) {
        console.error("Installation failed:", installResult.result);
        throw new Error("Failed to install AI SDK");
      }
      console.log("✓ AI SDK installed");
    }

    // Step 5: Run AI generation (Host Integration)
    console.log(`\n${isFollowUp ? '3' : '5'}. Running AI generation...`);
    console.log(`Model: ${model}`);
    console.log(`Prompt Summary: "${(prompt || "").substring(0, 100)}..."`);
    console.log("\nThis may take several minutes...\n");

    const formattedPrompt = `
    ${projectContext}

    Current User Request: ${prompt || "Create a modern blog website with markdown support and a dark theme"}

    Technical Requirements:
    - Use NextJS (App Router), TypeScript, and Tailwind CSS.
    - You MUST output ONLY a valid JSON object.
    - The JSON object should have a "files" array and a "commands" array.
    - "files": [{ "path": "string", "content": "string" }]
    - "commands": ["string"] (bash commands to run after file creation).
    
    If this is a new project:
    - Provide all necessary files for a working NextJS app (package.json, tailwind.config.ts, tsconfig.json, app/layout.tsx, app/page.tsx, etc).
    - Initialize "decisions_log.md" with your initial architectural choices and a brief log of our interaction.
    
    If this is a modification:
    - Use the Conversation History above to fully understand what the user intends, especially for short follow-ups like "proceed", "continue", or "do it".
    - ONLY output the files being changed or added.
    - Update "decisions_log.md" by providing its full content with the new log entry appended.
    `;

    if (isGemini) {
      console.log('Starting website generation with Gemini Host Integration...');

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Thinking about the architecture...' }));

      const response = await ai.models.generateContent({
        model: model,
        contents: [formattedPrompt], // Gemini v2 requires an array
        config: {
          responseMimeType: "application/json",
        }
      });

      const output = response.text || "{}";
      console.log('[Gemini]: Received JSON response');

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch (e) {
        console.error("Failed to parse Gemini JSON output", e);
        console.log('Raw output:', output);
        throw new Error("Failed to parse Gemini JSON output. Make sure the AI returns valid JSON.");
      }

      if (parsed.files && Array.isArray(parsed.files)) {
        for (const file of parsed.files) {
          if (!file.path || !file.content) continue;

          console.log('__TOOL_USE__', JSON.stringify({
            type: 'tool_use',
            name: 'WriteFile',
            input: { file_path: file.path }
          }));

          const dir = path.dirname(file.path);
          if (dir !== '.') {
            await sandbox.process.executeCommand(`mkdir -p ${dir}`, projectDir);
          }

          // Securely write file content to sandbox using cat and base64
          const base64Content = Buffer.from(file.content).toString('base64');
          await sandbox.process.executeCommand(`echo "${base64Content}" | base64 -d > "${file.path}"`, projectDir);

          console.log('Created file remotely in sandbox:', file.path);
        }
      }

      if (parsed.commands && Array.isArray(parsed.commands)) {
        for (const cmd of parsed.commands) {
          console.log('__TOOL_USE__', JSON.stringify({
            type: 'tool_use',
            name: 'RunCommand',
            input: { command: cmd }
          }));
          console.log('Running command remotely in sandbox:', cmd);
          try {
            const execRes = await sandbox.process.executeCommand(cmd, projectDir, undefined, 300000);
            if (execRes.exitCode !== 0) {
              console.warn(`Command "${cmd}" exited with code ${execRes.exitCode}: ${execRes.result}`);
            }
          } catch (e: any) {
            console.error("Command execution error:", cmd, e.message);
          }
        }
      }

      console.log('\nGeneration complete!');
      console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Generation finished successfully!' }));
    } else if (isClaude) {
      console.log('Starting website generation with Claude Code Host Integration...');
      throw new Error("Claude models are not fully supported in this SaaS host-isolated version yet. Please use Gemini.");
    }

    // Step 5: Check generated files
    console.log("\n5. Checking generated files...");
    const filesResult = await sandbox.process.executeCommand(
      "ls -la",
      projectDir
    );
    console.log(filesResult.result);

    // Step 6: Install dependencies if package.json was updated
    const hasNextJS = await sandbox.process.executeCommand(
      "test -f package.json && grep -q next package.json && echo yes || echo no",
      projectDir
    );

    if (hasNextJS.result?.trim() === "yes") {
      console.log("\n6. Installing project dependencies...");
      const npmInstall = await sandbox.process.executeCommand(
        "npm install",
        projectDir,
        undefined,
        300000 // 5 minute timeout
      );

      if (npmInstall.exitCode !== 0) {
        console.log("Warning: npm install had issues:", npmInstall.result);
      } else {
        console.log("✓ Dependencies installed");
      }

      // Step 7: Start dev server in background
      console.log("\n7. Starting development server in background...");

      // Start the server in background using nohup
      await sandbox.process.executeCommand(
        `nohup npm run dev > dev-server.log 2>&1 &`,
        projectDir,
        { PORT: "3000" }
      );

      console.log("✓ Server started in background");

      // Wait a bit for server to initialize
      console.log("Waiting for server to start...");
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Check if server is running
      const checkServer = await sandbox.process.executeCommand(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'failed'",
        projectDir
      );

      if (checkServer.result?.trim() === '200') {
        console.log("✓ Server is running!");
      } else {
        console.log("⚠️  Server might still be starting...");
        console.log("You can check logs with: cat dev-server.log");
      }
    }

    // Step 8: Get preview URL
    console.log("\n8. Getting preview URL...");
    const preview = await sandbox.getPreviewLink(3000);

    console.log("\n✨ SUCCESS! Website generated!");
    console.log("\n📊 SUMMARY:");
    console.log("===========");
    console.log(`Sandbox ID: ${sandboxId}`);
    console.log(`Project Directory: ${projectDir}`);
    console.log(`Preview URL: ${preview.url}`);
    if (preview.token) {
      console.log(`Access Token: ${preview.token}`);
    }

    console.log("\n🌐 VISIT YOUR WEBSITE:");
    console.log(preview.url);

    console.log("\n💡 TIPS:");
    console.log("- The sandbox will stay active for debugging");
    console.log("- Server logs: SSH in and run 'cat website-project/dev-server.log'");
    console.log(
      `- To get preview URL again: npx tsx scripts/get-preview-url.ts ${sandboxId}`
    );
    console.log(
      `- To reuse this sandbox: npx tsx scripts/generate-in-daytona.ts ${sandboxId}`
    );
    console.log(`- To remove: npx tsx scripts/remove-sandbox.ts ${sandboxId}`);

    return {
      success: true,
      sandboxId: sandboxId,
      projectDir: projectDir,
      previewUrl: preview.url,
    };
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);

    if (sandbox) {
      console.log(`\nSandbox ID: ${sandboxId}`);
      console.log("The sandbox is still running for debugging.");

      // Try to get debug info
      try {
        const debugInfo = await sandbox.process.executeCommand(
          "pwd && echo '---' && ls -la && echo '---' && test -f generate.js && cat generate.js | head -20 || echo 'No script'",
          `${await sandbox.getUserRootDir()}/website-project`
        );
        console.log("\nDebug info:");
        console.log(debugInfo.result);
      } catch (e) {
        // Ignore
      }
    }

    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let sandboxId: string | undefined;
  let prompt: string | undefined;
  let model: string | undefined;

  // The caller passes: tsx generate-in-daytona.ts <prompt> <model>
  // However, the caller might also pass a sandboxId.
  // We'll simplify and assume: args[0] is prompt, args[1] is model
  // Or handle the uuid check to maintain backwards compatibility

  if (args.length > 0) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(args[0])) {
      sandboxId = args[0];
      prompt = args[1];
      model = args[2];
    } else {
      prompt = args[0];
      model = args[1];
    }
  }

  if (!prompt) {
    prompt = "Create a modern blog website with markdown support and a dark theme.";
  }

  console.log("📝 Configuration:");
  console.log(`- Sandbox: ${sandboxId ? `Using existing ${sandboxId}` : "Creating new"}`);
  console.log(`- Prompt: ${prompt}`);
  console.log(`- Model: ${model || "gemini-2.5-flash (default)"}`);
  console.log();

  try {
    await generateWebsiteInDaytona(sandboxId, prompt, model);
  } catch (error) {
    console.error("Failed to generate website:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Exiting... The sandbox will continue running.");
  process.exit(0);
});

main();
