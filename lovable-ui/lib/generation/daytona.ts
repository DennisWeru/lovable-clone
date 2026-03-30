import { Daytona } from "@daytonaio/sdk";
import { GoogleGenAI } from "@google/genai";
import * as path from "path";

export interface GenerationOptions {
  sandboxId?: string;
  prompt: string;
  model: string;
  conversationHistory?: string;
  onProgress: (message: string) => void;
  onClaudeMessage: (content: string) => void;
  onToolUse: (name: string, input: any) => void;
  onError: (code: string, message: string) => void;
}

export interface GenerationResult {
  success: boolean;
  sandboxId: string;
  projectDir: string;
  previewUrl: string;
}

export async function generateWebsiteInDaytona({
  sandboxId: sandboxIdArg,
  prompt,
  model,
  conversationHistory = "",
  onProgress,
  onClaudeMessage,
  onToolUse,
  onError
}: GenerationOptions): Promise<GenerationResult> {
  onProgress("🚀 Starting website generation in Daytona sandbox...");

  const isClaude = model.startsWith("claude");
  const isGemini = model.startsWith("gemini");

  if (!process.env.DAYTONA_API_KEY) {
    onError('MISSING_API_KEY', 'DAYTONA_API_KEY must be set');
    throw new Error('DAYTONA_API_KEY must be set');
  }

  if (isGemini && !process.env.GEMINI_API_KEY) {
    onError('MISSING_API_KEY', 'GEMINI_API_KEY must be set for Gemini models');
    throw new Error('GEMINI_API_KEY must be set');
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  let sandbox;
  let sandboxId = sandboxIdArg;

  try {
    // Step 1: Create or get sandbox
    if (sandboxId) {
      onProgress(`1. Using existing sandbox: ${sandboxId}`);
      const result = await daytona.list();
      sandbox = result.items.find((s: any) => s.id === sandboxId);
      if (!sandbox) {
        onError('SANDBOX_NOT_FOUND', `Sandbox ${sandboxId} not found`);
        throw new Error(`Sandbox ${sandboxId} not found`);
      }
      onProgress(`✓ Connected to sandbox: ${sandbox.id}`);
    } else {
      onProgress("1. Creating new Daytona sandbox...");
      try {
        sandbox = await daytona.create({
          public: true,
          image: "node:20",
        });
        sandboxId = sandbox.id;
        onProgress(`✓ Sandbox created: ${sandboxId}`);
      } catch (e: any) {
        onError('SANDBOX_CREATION_FAILED', e.message);
        throw e;
      }
    }

    // Get the root directory
    const rootDir = await sandbox.getUserRootDir();
    onProgress(`✓ Working directory: ${rootDir}`);
    const projectDir = `${rootDir}/website-project`;

    let projectContext = "";
    const isFollowUp = !!sandboxIdArg;

    if (isFollowUp) {
      onProgress("\n2. Detecting existing project context and decisions log...");
      try {
        const lsResult = await sandbox.process.executeCommand("find . -maxdepth 3 -not -path '*/.*' -not -path '*/node_modules/*'", projectDir);
        const packageJson = await sandbox.process.executeCommand("cat package.json || echo '{}'", projectDir);
        const decisionsLog = await sandbox.process.executeCommand("cat decisions_log.md || echo ''", projectDir);
        
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
        onProgress("Could not read project context, falling back to full generation.");
      }
    } else {
      // Step 2: Create project directory
      onProgress("\n2. Setting up project directory...");
      await sandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir);
      onProgress(`✓ Created project directory: ${projectDir}`);

      // Step 3: Initialize npm project
      onProgress("\n3. Initializing npm project...");
      await sandbox.process.executeCommand("npm init -y", projectDir);
      onProgress("✓ Package.json created");

      // Step 4: Install AI SDK locally in project
      onProgress("\n4. Installing AI SDK locally...");
      const installCmd = isClaude ? "npm install @anthropic-ai/claude-code@latest" : "npm install @google/generative-ai dotenv";
      const installResult = await sandbox.process.executeCommand(
        installCmd,
        projectDir,
        undefined,
        300000 // 5 minute timeout
      );

      if (installResult.exitCode !== 0) {
        onError('NPM_INSTALL_FAILED', `Failed to install AI SDK: ${installResult.result}`);
        throw new Error("Failed to install AI SDK");
      }
      onProgress("✓ AI SDK installed");
    }

    // Step 5: Run AI generation
    onProgress(`\n${isFollowUp ? '3' : '5'}. Running AI generation...`);
    onProgress(`Model: ${model}`);

    const formattedPrompt = `
    ${projectContext}

    Current User Request: ${prompt}

    Technical Requirements:
    - Use NextJS (App Router), TypeScript, and Tailwind CSS.
    - You MUST output ONLY a valid JSON object.
    - The JSON object should have a "files" array and a "commands" array.
    - "files": [{ "path": "string", "content": "string" }]
    - "commands": ["string"] (bash commands to run after file creation).
    
    If this is a new project:
    - Provide all necessary files for a working NextJS app.
    - Initialize "decisions_log.md" with your initial architectural choices.
    
    If this is a modification:
    - ONLY output the files being changed or added.
    - Update "decisions_log.md" by providing its full content with the new log entry appended.
    `;

    if (isGemini) {
      onProgress('Starting website generation with Gemini...');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      onClaudeMessage('Thinking about the architecture...');

      const response = await ai.models.generateContent({
        model: model,
        contents: [formattedPrompt],
        config: {
          responseMimeType: "application/json",
        }
      });

      const output = response.text || "{}";
      onProgress('Received JSON response from AI.');

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch (e: any) {
        onError('AI_PARSE_ERROR', "Failed to parse AI response as JSON");
        throw new Error("Failed to parse Gemini JSON output.");
      }

      if (parsed.files && Array.isArray(parsed.files)) {
        for (const file of parsed.files) {
          if (!file.path || !file.content) continue;
          onToolUse('WriteFile', { file_path: file.path });

          const dir = path.dirname(file.path);
          if (dir !== '.') {
            await sandbox.process.executeCommand(`mkdir -p ${dir}`, projectDir);
          }

          const base64Content = Buffer.from(file.content).toString('base64');
          await sandbox.process.executeCommand(`echo "${base64Content}" | base64 -d > "${file.path}"`, projectDir);
        }
      }

      if (parsed.commands && Array.isArray(parsed.commands)) {
        for (const cmd of parsed.commands) {
          onToolUse('RunCommand', { command: cmd });
          try {
            const execRes = await sandbox.process.executeCommand(cmd, projectDir, undefined, 300000);
            if (execRes.exitCode !== 0) {
              onProgress(`⚠️ Command "${cmd}" exited with code ${execRes.exitCode}`);
            }
          } catch (e: any) {
            onProgress(`❌ Command execution error: ${cmd}`);
          }
        }
      }

      onProgress('\nGeneration complete!');
      onClaudeMessage('Generation finished successfully!');
    } else {
      throw new Error(`Model ${model} not supported in library version.`);
    }

    // Step 5: Check generated files
    onProgress("\n5. Checking generated files...");
    const filesResult = await sandbox.process.executeCommand("ls -la", projectDir);
    onProgress(filesResult.result || "No files found");

    // Step 6: Install dependencies
    const hasNextJS = await sandbox.process.executeCommand(
      "test -f package.json && grep -q next package.json && echo yes || echo no",
      projectDir
    );

    if (hasNextJS.result?.trim() === "yes") {
      onProgress("\n6. Installing project dependencies...");
      const npmInstall = await sandbox.process.executeCommand("npm install", projectDir, undefined, 300000);

      if (npmInstall.exitCode !== 0) {
        onError('NPM_INSTALL_FAILED', `Project dependencies installation failed: ${npmInstall.result}`);
      } else {
        onProgress("✓ Dependencies installed");
      }

      onProgress("\n7. Starting development server in background...");
      await sandbox.process.executeCommand("fuser -k 3000/tcp || true", projectDir);
      await sandbox.process.executeCommand(`nohup npm run dev > dev-server.log 2>&1 &`, projectDir, { PORT: "3000" });
      onProgress("✓ Server started in background");

      onProgress("Waiting for server to start...");
      await new Promise((resolve) => setTimeout(resolve, 8000));

      const checkServer = await sandbox.process.executeCommand(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'failed'",
        projectDir
      );

      if (checkServer.result?.trim() === '200') {
        onProgress("✓ Server is running!");
      } else {
        onError('SERVER_START_TIMEOUT', 'Development server is taking too long to start');
      }
    }

    onProgress("\n8. Getting preview URL...");
    const preview = await sandbox.getPreviewLink(3000);

    return {
      success: true,
      sandboxId: sandboxId!,
      projectDir: projectDir,
      previewUrl: preview.url,
    };
  } catch (error: any) {
    onProgress(`\n❌ ERROR: ${error.message}`);
    throw error;
  }
}
