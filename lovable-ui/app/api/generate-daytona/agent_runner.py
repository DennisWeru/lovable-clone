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

def log_status(message: str, type: str = "progress"):
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

    # 1. Try with conversation_id= (Primary for 1.16.0)
    try:
        conv = Conversation(
            agent=agent, 
            workspace=workspace,
            persistence_dir=persistence_dir,
            conversation_id=conv_uuid
        )
        log_status("Safe creation success with 'conversation_id'", "status")
        return conv
    except TypeError as e:
        log_status(f"Constructor with 'conversation_id' failed: {str(e)}", "status")

    # 2. Try with id= (Fallback for some variants)
    try:
        conv = Conversation(
            agent=agent, 
            workspace=workspace,
            persistence_dir=persistence_dir,
            id=conv_uuid
        )
        log_status("Safe creation success with 'id'", "status")
        return conv
    except TypeError as e:
        log_status(f"Constructor with 'id' failed: {str(e)}", "status")

    # 3. Try with conv_id= (Found in some introspections)
    try:
        conv = Conversation(
            agent=agent, 
            workspace=workspace,
            persistence_dir=persistence_dir,
            conv_id=conv_uuid
        )
        log_status("Safe creation success with 'conv_id'", "status")
        return conv
    except TypeError as e:
        log_status(f"Constructor with 'conv_id' failed: {str(e)}", "status")

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

        # 1.16.0 Subscription Pattern
        def on_event(event: Any):
            try:
                # 1. Capture Thought/Reasoning from the event itself (modern SDK)
                if hasattr(event, "reasoning_content") and event.reasoning_content:
                    log_status(event.reasoning_content, "progress")
                
                # 2. Capture Action (Tool Use)
                if hasattr(event, "action") and event.action:
                    action = event.action
                    name = type(action).__name__
                    
                    # Extract 'thought' if present in the action itself
                    thought = getattr(action, "thought", "")
                    if thought:
                        log_status(thought, "progress")

                    # Map to a consistent JSON format for the worker
                    print(json.dumps({
                        "type": "tool_use",
                        "name": name,
                        "id": getattr(event, "id", "unknown"),
                        "input": getattr(action, "args", getattr(action, "__dict__", {}))
                    }), flush=True)

                # 3. Capture Observation (Tool Result)
                if hasattr(event, "observation") and event.observation:
                    observation = event.observation
                    name = type(observation).__name__
                    # Map to a consistent JSON format for the worker
                    print(json.dumps({
                        "type": "tool_result",
                        "name": name,
                        "ref_id": getattr(event, "action_id", "unknown"),
                        "result": getattr(observation, "content", str(observation))
                    }), flush=True)

            except Exception as e:
                # Silent failure for events to avoid crashing the main loop
                pass

        # Using string "main" to avoid 'No module named openhands.core' if EventStreamSubscriber is missing
        conversation.event_stream.subscribe("main", on_event)

        log_status("Agent is thinking and executing tasks...", "progress")
        
        # Heartbeat to keep worker's friendly rotation disabled during long thinking
        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                log_status("Agent active: processing next steps...", "progress")
        
        hb_handle = asyncio.create_task(heartbeat())
        
        # We wrap the run call. Currently the SDK run() is blocking.
        conversation.send_message(prompt)
        conversation.run()
        hb_handle.cancel()

        log_status("Agent execution completed successfully!", "complete")
        
    except Exception as e:
        log_status(f"Agent Error: {str(e)}", "error")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
