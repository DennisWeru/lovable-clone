import { generateWebsiteInDaytona } from "../lib/generation/daytona";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function main() {
  const args = process.argv.slice(2);
  let sandboxIdArg: string | undefined;
  let promptArg: string | undefined;
  let modelArg: string | undefined;

  if (args.length > 0) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(args[0])) {
      sandboxIdArg = args[0];
      promptArg = args[1];
      modelArg = args[2];
    } else {
      promptArg = args[0];
      modelArg = args[1];
    }
  }

  const prompt = promptArg || "Create a modern blog website with markdown support and a dark theme.";
  const model = modelArg || "gemini-2.5-flash";

  console.log("📝 Configuration:");
  console.log(`- Sandbox: ${sandboxIdArg ? `Using existing ${sandboxIdArg}` : "Creating new"}`);
  console.log(`- Prompt: ${prompt}`);
  console.log(`- Model: ${model}`);
  console.log();

  try {
    const result = await generateWebsiteInDaytona({
      sandboxId: sandboxIdArg,
      prompt,
      model,
      conversationHistory: process.env.CONVERSATION_HISTORY || "",
      onProgress: (msg) => console.log(msg),
      onClaudeMessage: (content) => console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content })),
      onToolUse: (name, input) => console.log('__TOOL_USE__', JSON.stringify({ type: 'tool_use', name, input })),
      onError: (code, message) => console.log('__ERROR__', JSON.stringify({ code, message }))
    });

    console.log("\n✨ SUCCESS! Website generated!");
    console.log(`Preview URL: ${result.previewUrl}`);
  } catch (error) {
    console.error("Failed to generate website:", error);
    process.exit(1);
  }
}

main();
