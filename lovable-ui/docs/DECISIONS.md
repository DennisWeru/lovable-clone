# Decision Log

## Dynamic Model Selection from OpenRouter (2026-03-30)

### Problem
Previously, the model selection on the landing page was hardcoded, limiting users to a small set of predefined models.

### Solution
Implemented a dynamic model selector that fetches 'live' models from the OpenRouter API.

### Changes
1.  **API Integration**: Added `app/api/models/route.ts` to fetch and sort models from `https://openrouter.ai/api/v1/models`.
2.  **ModelSelector Component**: Created a searchable dropdown component (`components/ModelSelector.tsx`) to handle the large list of models (~200+).
3.  **Landing Page Update**: Integrated `ModelSelector` into `app/page.tsx`.
4.  **Backend Consistency**: Updated default model to `google/gemini-3.1-flash-lite-preview` across `app/page.tsx`, `app/generate/page.tsx` and `app/api/generate-daytona/route.ts`.

### Rationale
-   **OpenRouter API**: Provides access to a wide variety of models without manual updates.
-   **Searchable Dropdown**: Essential for a good UX given the sheer number of models available on OpenRouter.

## Locked Dependency Versions for Agent Sandbox (2026-03-30)

### Problem
The Daytona sandbox environment runs **Node v20.15.0**. The agent was using `npm create vite@latest`, which pulled Vite 6+. Vite 6 requires **Node ^20.19.0 || >=22.12.0**, leading to `EBADENGINE` warnings and fatal native binding errors (`rolldown` failing to load). Additionally, mismatched Playwright versions caused redundant browser downloads and execution errors.

### Solution
Locked core tool versions in the agent's system prompt and worker bootstrap script:
1.  **Vite**: Forced to `vite@5` in the initialization command.
2.  **Playwright**: Forced to `playwright@1.45.0` to match the pre-installed browsers in the `mcr.microsoft.com/playwright:v1.45.0-jammy` container image.

### Changes
-   Modified `app/api/generate-daytona/route.ts`:
    -   Updated `systemMessage` to enforce `vite@5` and `playwright@1.45.0`.
    -   Updated worker bootstrap to explicitly install `playwright@1.45.0`.
    -   Updated worker bootstrap to detect user (`whoami`) and skip `sudo` if running as `root`, preventing failures in certain Docker images.

### Rationale
-   **Compatibility**: Vite 5 supports Node 20.15.0 perfectly, avoiding the `rolldown` native binding issues.
-   **Performance**: Matching the Playwright version to the container image prevents the agent from spending minutes downloading new browser binaries on every run.
-   **Stability**: Version locking prevents "silent" breakages when major versions of upstream tools are released.

## Switch to Claude Code CLI for Agentic Workflow (2026-03-31)

### Problem
The custom Node.js/OpenRouter agentic worker was complex to maintain, prone to tool-calling errors, and lacked the robust autonomous capabilities of modern specialized CLI agents like Claude Code.

### Solution
Replaced the custom agent loop with a bootstrap worker that leverages the **Claude Code CLI** (`@anthropic-ai/claude-code`) running within the Daytona sandbox. 

### Key Integration Points
1.  **OpenRouter Compatibility**: Configured Claude Code to use OpenRouter as its backend by injecting `ANTHROPIC_BASE_URL` ("https://openrouter.ai/api") and `ANTHROPIC_AUTH_TOKEN` (the OpenRouter API key) into the worker's environment.
2.  **Visual Verification**: Created a specialized `snapshot.mjs` script in the sandbox root. This allows Claude to take screenshots of the running Vite server (on port 3000) using the pre-installed Playwright 1.45.0 drivers.
3.  **UI Feedback**: Piped Claude's terminal output (stdout/stderr) directly to the existing project webhooks, ensuring the "Agent Console Logs" in the frontend remain functional and real-time.
4.  **Auto-Approval**: Configured Claude with `--allowedTools Read,Edit,Bash` and `-p` (non-interactive mode) for autonomous execution.
5.  **Project Rules**: Injected a `CLAUDE.md` file into the sandbox project directory to enforce core standards: Vite 5, Tailwind CSS, and port 3000 hosting.

### Rationale
-   **Robustness**: Claude Code is built and optimized by Anthropic for high-reliability tool usage and self-correction.
-   **Lower Maintenance**: Eliminates the need to maintain a custom, multi-hundred-line tool-calling loop in `route.ts`.
-   **OpenRouter Support**: Maintains the existing billing and credit deduction logic by using OpenRouter's Anthropic-compatible API skin.
-   **Visual Feedback**: Preserves the ability to "see" the generated website through Playwright snapshots, which Claude can now trigger via standard bash commands.

## Resolving Claude Code Installation Timeout (2026-03-31)

### Problem
Users encountered `spawnSync /bin/sh ETIMEDOUT` errors in production when the agent attempted to install `@anthropic-ai/claude-code` globally. The default 120s timeout was insufficient for downloading and installing the CLI and its dependencies in the Daytona sandbox environment.

### Solution
Hardened the bootstrapping process in the agent worker:
1.  **Increased installation timeout**: Bumped the `npm install -g` timeout from 120s to **300s (5 minutes)**.
2.  **Implemented `npx` Execution Fallback**: Modified the worker's `runClaude` function to attempt a global `claude` call first, but automatically fallback to `npx --yes @anthropic-ai/claude-code` if the global command is not found (`ENOENT`).
3.  **Optimized npm flags**: Added `--no-fund --no-audit` to the installation command to reduce network overhead and speed up the process.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Updated `npmCmd` with optimized flags and 300,000ms timeout.
    -   Refactored `runClaude` as an asynchronous promise-based function with `npx` fallback logic.
    -   Enhanced worker logging for both stdout and stderr to improve observability during failure.

### Rationale
-   **Resilience**: The `npx` fallback ensures that even if the global installation takes too long or fails due to ephemeral file system issues, the agent can still attempt to run by downloading it on-demand during the execution phase.
-   **Observability**: Improved logging helps diagnose why an installation might be slow or failing in specific sandbox regions.
-   **User Experience**: Prevents "Fatal error in main loop" crashes that were completely blocking website generation for users.

## Fixing Shell Injection in Claude Code Spawning (2026-03-31)

### Problem
Prompts containing semicolons or other shell-special characters were causing `Fatal: Claude exited with code 127`. Because `shell: true` was enabled in Node's `spawn`, the shell was interpreting the semicolon in the prompt as a command separator, attempting to run the rest of the prompt as a standalone command (e.g., trying to run "This page isn't working..." as a binary).

### Solution
Removed `shell: true` from all `spawn` calls within the worker script. By using the array-of-arguments form of `spawn` without a shell, Node.js handles argument passing directly to the OS, ensuring that the prompt is passed to Claude Code as a single literal argument regardless of its content.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Removed `shell: true` from the `claude` spawn.
    -   Removed `shell: true` from the `npx` fallback spawn.

### Rationale
-   **Security**: Prevents potential shell injection vulnerabilities.
-   **Robustness**: Allows the agent to handle any prompt text without mangling the command structure.

## Hardening Claude Code Authentication and Non-Interactive Execution (2026-03-31)

### Problem
Despite successfully spawning the Claude CLI, the agent remained "stuck" after the initial stdin warning. This was due to two factors:
1.  **Authentication Gap**: `ANTHROPIC_API_KEY` was being set to an empty string, which likely triggered an interactive login prompt that the non-interactive agent could not fulfill.
2.  **Stdin Wait**: The CLI was waiting several seconds for potentially piped input, which was unnecessary for this automated workflow.

### Solution
Ensured total non-interactive execution and proper auth passed through OpenRouter:
1.  **Auth Fix**: Explicitly set `ANTHROPIC_API_KEY` to the `OPENROUTER_API_KEY`. This informs the Anthropic SDK (used by Claude Code) to use the provided key for all backend requests.
2.  **Piped Stdin**: Configured `stdio: ["ignore", "pipe", "pipe"]` in the Node `spawn` call. This is the equivalent of running `claude < /dev/null`, which tells the CLI immediately that no piped input is coming, bypassing the "Warning: no stdin data" wait time.
3.  **Enhanced Debugging**: Switched to `process.stdout.write` and `process.stderr.write` within the worker script to ensure that the worker's own console logs capture the detailed output from the spawned CLI for easier troubleshooting.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Updated the `env` object in `runClaude` to include `ANTHROPIC_API_KEY`.
    -   Added `stdio` configuration to both the primary and fallback `spawn` calls.
    -   Improved worker-side output logging.

### Rationale
-   **Eliminate Interaction**: Removes all possible blockers where the CLI might pause to wait for user input.
-   **Direct Auth**: Ensures the underlying SDK recognizes the API key correctly when pointing to the OpenRouter base URL.

## Fixing Preview Hang by Ensuring Dev Server Persistence (2026-03-31)

### Problem
Users reported a project state of "completed" in the logs, but the preview window remained stuck on "Spinning up preview environment...". This was because the Claude CLI was starting the dev server as a child process which was then being terminated as soon as the CLI finished its task and exited. Furthermore, the worker was sending a "complete" status update *immediately* when the CLI exited, before any persistent server was actually running.

### Solution
Ensured the dev server is detached and persistent, and delayed the completion signal until it is ready:
1.  **Persistent Background Start**: Modified the worker's `main()` loop to explicitly start the Vite dev server using `nohup ... &` AFTER the Claude CLI finishes. This ensures the process survives the end of the worker session.
2.  **Delayed Completion Signal**: Removed the premature "complete" update from the CLI's `on("close")` handler. The worker now only signals completion AFTER the server and background steps are confirmed.
3.  **Readiness Probe**: Implemented a 10-second polling loop using `curl` to verify that the server is actually responding on port 3000 before the UI is told to load the preview URL.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Added a server start and verification block in the `main()` function.
    -   Removed the `sendUpdate("complete")` call from `runClaude()`.

### Rationale
-   **User Experience**: Prevents the confusing state where a project is "done" but the website can't be viewed.
-   **Reliability**: Provides a much more stable handoff from the "Agent thinking" phase to the "Live Preview" phase.

## Fixing Inconsistent Navbar Auth State (2026-03-31)

### Problem
Users reported that the Navbar would "sometimes" show a 'Log in' button even when they were already authenticated and actively using the dashboard. This was caused by several issues in the `Navbar` component:
1.  **Flickering Auth Status**: The `user` state was initialized to `null`. During the initial client-side auth check, the component would default to rendering the unauthenticated UI (Log in/Get started buttons).
2.  **Performance & Stability**: The `createClient()` (Supabase) function was called on every render, creating a new client instance and causing the `useEffect` to re-synchronize and re-subscribe to auth changes on every single state update.
3.  **Race Conditions**: Multiple competing auth check logic paths (`getUserData` vs `onAuthStateChange`).

### Solution
Implemented a more robust auth state management in `Navbar.tsx`:
1.  **Client Persistence**: Memoized the Supabase client instance with `useMemo` to ensure stability and prevent redundant re-subscriptions.
2.  **Loading State**: Introduced an `isLoading` boolean to the `Navbar`. The component now hides auth-related buttons until the actual auth status is confirmed from Supabase.
3.  **Unified Listener**: Refactored the auth check to rely primarily on `onAuthStateChange` for consistent updates across the application.

### Changes
-   Modified `lovable-ui/components/Navbar.tsx`:
    -   Added `useMemo` for the Supabase browser client.
    -   Integrated `isLoading` state and corresponding UI logic.
    -   Cleaned up redundant auth checks.

### Rationale
-   **User Experience**: Eliminates the "flash of unauthenticated content" which made the app feel buggy and slow.
-   **Optimization**: Reducing the number of Supabase client instances and subscription cycles improves client-side performance and prevents potential memory leaks or rate-limiting issues.
