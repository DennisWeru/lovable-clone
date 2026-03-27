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

    // Step 2: Create project directory
    console.log("\n2. Setting up project directory...");
    const projectDir = `${rootDir}/website-project`;
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

    // Step 5: Create the generation script file
    console.log("\n5. Creating generation script file...");

    let generationScript = "";

    if (isClaude) {
      generationScript = `const { query } = require('@anthropic-ai/claude-code');
const fs = require('fs');

async function generateWebsite() {
  const prompt = \`${
    prompt ||
    "Create a modern blog website with markdown support and a dark theme"
  }
  
  Important requirements:
  - Create a NextJS app with TypeScript and Tailwind CSS
  - Use the app directory structure
  - Create all files in the current directory
  - Include a package.json with all necessary dependencies
  - Make the design modern and responsive
  - Add at least a home page and one other page
  - Include proper navigation between pages
  \`;

  console.log('Starting website generation with Claude Code...');
  console.log('Working directory:', process.cwd());
  
  const messages = [];
  const abortController = new AbortController();
  
  try {
    for await (const message of query({
      prompt: prompt,
      abortController: abortController,
      options: {
        maxTurns: 20,
        allowedTools: [
          'Read',
          'Write',
          'Edit',
          'MultiEdit',
          'Bash',
          'LS',
          'Glob',
          'Grep'
        ]
      }
    })) {
      messages.push(message);
      
      // Log progress
      if (message.type === 'text') {
        console.log('[Claude]:', (message.text || '').substring(0, 80) + '...');
        console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: message.text }));
      } else if (message.type === 'tool_use') {
        console.log('[Tool]:', message.name, message.input?.file_path || '');
        console.log('__TOOL_USE__', JSON.stringify({ 
          type: 'tool_use', 
          name: message.name, 
          input: message.input 
        }));
      } else if (message.type === 'result') {
        console.log('__TOOL_RESULT__', JSON.stringify({ 
          type: 'tool_result', 
          result: message.result 
        }));
      }
    }
    
    console.log('\\nGeneration complete!');
    console.log('Total messages:', messages.length);
    
    // Save generation log
    fs.writeFileSync('generation-log.json', JSON.stringify(messages, null, 2));
    
  } catch (error) {
    console.error('Generation error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

generateWebsite().catch(console.error);`;
    } else {
      generationScript = `const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function generateWebsite() {
  const prompt = \`${
    prompt ||
    "Create a modern blog website with markdown support and a dark theme"
  }

  Important requirements:
  - Create a NextJS app with TypeScript and Tailwind CSS
  - You MUST output ONLY valid JSON.
  - The JSON object should have a "files" array and a "commands" array.
  - "files" is an array of objects with "path" and "content" fields.
  - "commands" is an array of strings representing bash commands to run AFTER files are created (e.g. "npm install").
  - Provide complete, robust code. Include a valid package.json.
  - Provide a basic index page and at least one component.
  \`;

  console.log('Starting website generation with Gemini...');
  console.log('Working directory:', process.cwd());

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "${model}" });

  try {
    console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Thinking about the architecture...' }));

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const response = result.response;
    const output = response.text();
    console.log('[Gemini]: Received JSON response');

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (e) {
      console.error("Failed to parse Gemini JSON output", e);
      console.log('Raw output:', output);
      process.exit(1);
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
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file.path, file.content);
        console.log('Created file:', file.path);
      }
    }

    if (parsed.commands && Array.isArray(parsed.commands)) {
      for (const cmd of parsed.commands) {
        console.log('__TOOL_USE__', JSON.stringify({
          type: 'tool_use',
          name: 'RunCommand',
          input: { command: cmd }
        }));
        console.log('Running command:', cmd);
        try {
          execSync(cmd, { stdio: 'inherit' });
        } catch (e) {
          console.error("Command failed:", cmd, e.message);
        }
      }
    }

    console.log('\\nGeneration complete!');
    console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Generation finished successfully!' }));
    
  } catch (error) {
    console.error('Generation error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

generateWebsite().catch(console.error);`;
    }

    // Write the script to a file
    await sandbox.process.executeCommand(
      `cat > generate.js << 'SCRIPT_EOF'
${generationScript}
SCRIPT_EOF`,
      projectDir
    );
    console.log("✓ Generation script written to generate.js");

    // Step 6: Run the generation script
    console.log("\n6. Running AI generation...");
    console.log(`Model: ${model}`);
    console.log(`Prompt: "${prompt || "Create a modern blog website"}"`);
    console.log("\nThis may take several minutes...\n");

    const formattedPrompt = `${
      prompt ||
      "Create a modern blog website with markdown support and a dark theme"
    }

    Important requirements:
    - Create a NextJS app with TypeScript and Tailwind CSS
    - You MUST output ONLY valid JSON.
    - The JSON object should have a "files" array and a "commands" array.
    - "files" is an array of objects with "path" and "content" fields.
    - "commands" is an array of strings representing bash commands to run AFTER files are created (e.g. "npm install").
    - Provide complete, robust code. Include a valid package.json.
    - Provide a basic index page and at least one component.
    `;

    if (isClaude) {
      console.log('Starting website generation with Claude Code Host Integration...');
      // To properly host claude code logic we would mock the tools to execute remotely in daytona sandbox.
      // For this SaaS iteration, we are sticking strictly to Gemini natively for full remote execution handling.
      throw new Error("Claude models are not fully supported in this SaaS host-isolated version yet. Please use Gemini.");
    } else {
      console.log('Starting website generation with Gemini Host Integration...');

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Thinking about the architecture...' }));

      const response = await ai.models.generateContent({
        model: model,
        contents: formattedPrompt,
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
        throw new Error("Failed to parse Gemini JSON output");
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

          // Securely write file content to sandbox using cat
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
              console.warn("Command exited with non-zero code:", execRes.result);
            }
          } catch (e: any) {
            console.error("Command execution error:", cmd, e.message);
          }
        }
      }

      console.log('\nGeneration complete!');
      console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: 'Generation finished successfully!' }));
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
