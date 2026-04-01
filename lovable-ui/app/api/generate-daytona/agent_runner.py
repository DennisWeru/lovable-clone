import os
import sys
import json
import asyncio
from typing import Optional
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.terminal import TerminalTool

def log_status(message: str, type: str = "status"):
    print(json.dumps({"type": type, "message": message}), flush=True)

async def main():
    prompt = os.getenv("GENERATION_PROMPT", "")
    model = os.getenv("GENERATION_MODEL", "google/gemini-3.1-flash-lite-preview")
    api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = "https://openrouter.ai/api/v1"
    project_dir = os.getenv("OPENHANDS_WORKSPACE_BASE", "/home/daytona/website-project")
    sid = os.getenv("OPENHANDS_SID")

    if not prompt:
        log_status("No prompt provided", "error")
        sys.exit(1)

    log_status(f"Initializing OpenHands SDK with model: {model}...")

    try:
        llm = LLM(
            model=f"openrouter/{model}",
            api_key=api_key,
            base_url=base_url,
        )

        agent = Agent(
            llm=llm,
            tools=[
                Tool(name=TerminalTool.name),
                Tool(name=FileEditorTool.name),
                Tool(name=TaskTrackerTool.name),
            ],
            # Use the default agent behavior but with our custom rules
        )

        log_status("Starting conversation loop...")
        
        # OpenHands SDK allows creating a conversation and running it.
        # We can pass the project_dir as the workspace.
        conversation = Conversation(
            agent=agent, 
            workspace=project_dir,
            sid=sid
        )

        # Inject the custom rules if they exist (we created CLAUDE.md in worker.mjs)
        # The agent will naturally see CLAUDE.md in its workspace.

        log_status("Agent is thinking and executing tasks...", "progress")
        
        # We wrap the run call. Currently the SDK run() is blocking.
        # But we can try to use its event hooks if we want finer control.
        # For now, let's just run. Its stdout should still pipe normally.
        conversation.send_message(prompt)
        conversation.run()

        log_status("Agent execution completed successfully!", "complete")
        
    except Exception as e:
        log_status(f"Agent Error: {str(e)}", "error")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
