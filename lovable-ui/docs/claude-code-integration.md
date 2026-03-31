# Claude Code CLI Integration Roadmap

## Feasibility Assessment
It is **highly feasible** to transition the current agent logic to use Claude Code. Since we are already using **Daytona sandboxes**, we have the perfect environment for a persistent agentic CLI to run.

---

## Strategy & Key Steps

### 1. Environment Compatibility
-   **Node Version**: Claude Code requires Node.js (v18+). Daytona currently uses **Node 20.15.0**.
-   **Installation**: We can install it on-the-fly using `npm install -g @anthropic-ai/claude-code` or run it via `npx`.

### 2. Authorization & Provider (OpenRouter Support)
-   **Compatibility**: YES, Claude Code can use your **OpenRouter key**. It supports the Anthropic API skin that OpenRouter provides.
-   **Configuration**: We will pass the following environment variables into the Daytona sandbox:
    -   `ANTHROPIC_BASE_URL`: `https://openrouter.ai/api`
    -   `ANTHROPIC_AUTH_TOKEN`: `your_openrouter_key`
    -   `ANTHROPIC_API_KEY`: `""` (empty string)
-   **Permissions**: Claude Code requires the user (agent) to approve certain actions. For automation, we will use the `--allowedTools` flag to pre-approve `Read`, `Edit`, and `Bash` commands.

### 3. Log Stream & UI Feedback
-   The current system expects structured updates (progress, tool_use, etc.) via a webhook.
-   Claude Code emits text to stdout/stderr. We can wrap the `claude` command in a small proxy script that parses this output and sends updates to the `WEBHOOK_URL`.

### 4. Visual Verification (Screenshots)
-   The current system uses a custom `take_screenshot` tool.
-   Claude Code doesn't have a built-in screenshot tool but allows users to provide **MCP (Model Context Protocol)** servers.
-   *Solution*: We can either:
    1.  Expose our current Playwright logic as an MCP server.
    2.  Write a bash script in the sandbox that Claude can call to capture and analyze the UI.

---

## Task List

- [ ] **Research**
  - [ ] Test `claude -p "Prompt"` headless mode performance.
  - [ ] Identify a reliable way to capture "Thinking" state for UI progress bars.
- [ ] **Implementation**
  - [ ] Update `app/api/generate-daytona/route.ts` to inject the OpenRouter key as `ANTHROPIC_AUTH_TOKEN` and set `ANTHROPIC_BASE_URL`.
  - [ ] Create a `claude-worker.sh` that initializes the project and calls Claude.
  - [ ] Update frontend to allow selecting "Claude Code" as an engine.
- [ ] **Enhancement**
  - [ ] Port Playwright visual-diffing to a script Claude can use.
  - [ ] Configure `CLAUDE.md` to enforce the Lovaclone design system and tech stack.
