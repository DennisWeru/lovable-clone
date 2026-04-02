import os
import sys
import json
import asyncio
from typing import Optional
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.terminal import TerminalTool

import inspect
from typing import Any, Dict

def log_status(message: str, type: str = "status"):
    print(json.dumps({"type": type, "message": message}), flush=True)

import uuid

def safe_create_conversation(agent: Agent, workspace: str, persistence_dir: str, conv_id: str) -> Conversation:
    """Safely create a conversation by trying multiple known argument patterns."""
    log_status(f"Inspecting Conversation signature: {inspect.signature(Conversation)}", "status")
    
    conv_uuid = None
    if conv_id:
        try:
            conv_uuid = uuid.UUID(conv_id)
        except ValueError:
            # If it's an arbitrary string like 'sid-xyz', generate a deterministic UUID
            conv_uuid = uuid.uuid5(uuid.NAMESPACE_OID, conv_id)

    # 1. Try with id=
    try:
        return Conversation(
            agent=agent, 
            workspace=workspace,
            persistence_dir=persistence_dir,
            id=conv_uuid
        )
    except TypeError as e:
        log_status(f"Constructor with 'id' failed: {str(e)}", "status")
    
    # 2. Try with conversation_id=
    try:
        return Conversation(
            agent=agent, 
            workspace=workspace,
            persistence_dir=persistence_dir,
            conversation_id=conv_uuid
        )
    except TypeError as e:
        log_status(f"Constructor with 'conversation_id' failed: {str(e)}", "status")

    # 3. Try fallback - minimal arguments
    log_status("Falling back to minimal Conversation initialization", "status")
    return Conversation(agent=agent, workspace=workspace)

async def main():
    prompt = os.getenv("GENERATION_PROMPT", "")
    model = os.getenv("GENERATION_MODEL", "google/gemini-3.1-flash-lite-preview")
    api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = "https://openrouter.ai/api/v1"
    project_dir = os.getenv("OPENHANDS_WORKSPACE_BASE", "/home/daytona/website-project")
    conv_id = os.getenv("OPENHANDS_SID")

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
            system_prompt="""You are Lovabee, an expert AI web developer.
YOUR CORE DUTY:
1. ALWAYS maintain a `decisions.md` file in the root directory.
2. At the start of EVERY task, read `decisions.md` and `CLAUDE.md` to understand context.
3. NEVER recreate the project if files already exist.
4. Document all major architectural changes, new dependencies, and feature implementations in `decisions.md`.
5. Use React, Vite, and Tailwind CSS for all projects.
6. Target port 3000 for the development server."""
        )

        log_status("Starting conversation loop...")
        
        # OpenHands SDK uses persistence_dir for state management.
        persistence_dir = os.path.join(os.path.dirname(project_dir), ".openhands_state")
        if not os.path.exists(persistence_dir):
            os.makedirs(persistence_dir, exist_ok=True)

        conversation = safe_create_conversation(agent, project_dir, persistence_dir, conv_id)

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
