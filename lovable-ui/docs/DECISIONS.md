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

## Improving Agent Generation Feedback with Friendly Status Messages (2026-03-31)

### Problem
When the website generation process was running, the UI would often show "Developing your website..." or "Thinking about next steps..." for extended periods without meaningful updates. This led to a poor user experience where users might think the process was stuck or had failed.

### Solution
Enhanced the generation worker with a proactive status reporting system:
1.  **Friendly Message Rotator**: Implemented a background interval in the worker that periodically (every 15 seconds) sends encouraging and descriptive status updates if no other activity has been reported by the agent.
2.  **Descriptive Progress Messages**: Replaced generic "Thinking..." or "Bootstrapping..." messages with more professional and exciting progress updates at each stage of the environment setup and CLI installation.
3.  **Active Monitoring**: Updated the `sendUpdate` function to track the `lastUpdateAt` timestamp, ensuring that friendly messages are only injected during periods of silence.
4.  **Emoji Integration**: Added context-aware emojis (✨, 🚀, 📦, 🤖, 🎉) to progress messages to make the UI feel more alive and friendly.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Added `FRIENDLY_MESSAGES` array with 12 distinct status variants.
    -   Implemented `startFriendlyRotation()` and `lastUpdateAt` tracking.
    -   Upgraded all manual `sendUpdate` calls with improved messaging.
    -   Added "Agent active with tools..." heartbeat during Claude's execution to keep the "Current Activity" snackbar updated.

### Rationale
-   **User Retention**: Keeping the user informed and engaged during a 1-3 minute generation process is critical for perceived performance and trust.
-   **Clarity**: The new messages provide a better sense of value, showing that the system is "designing", "optimizing", and "polishing" rather than just "thinking".
-   **Reduced Worry**: The periodic updates eliminate the "is it stuck?" anxiety that occurs when the screen doesn't change for 20+ seconds.

## Optimizing Claude Code Bootstrapping and Persistence (2026-03-31)

### Problem
Users reported the agent getting "stuck" for long periods (up to 14 minutes) during the initial creation of a project. Logs revealed that the global installation of `@anthropic-ai/claude-code` often timed out, and the `npx` fallback was extremely slow because it downloaded the package every single time without a persistent cache.

### Solution
Overhauled the agent bootstrap logic to prioritize persistence, reliability, and speed:
1.  **Persistent Local Installation**: Modified the worker to install the Claude CLI into a dedicated directory (`/home/daytona/.claude`) within the sandbox. This directory is persistent across project resumes, ensuring the 14-minute install only happens once per sandbox life.
2.  **Removed Timeouts**: Removed the 300s (5-minute) hard timeout on the installation command. In some network environments, the download genuinely takes longer, and a timeout led to a confusing "stuck" state where `npx` would then start from scratch.
3.  **Local vs Global Priority**: Updated the logic to check for the persistent local binary first, then global, then finally falling back to a local `npm install`.
4.  **Persistent NPX Cache**: Configured `NPM_CONFIG_CACHE` to point to `/home/daytona/.npm-cache`, ensuring that even if `npx` is used, it can reuse previously downloaded layers.
5.  **Improved UI Feedback**: Added more specific "Initializing agent..." messages and extended the rotation of friendly status messages to keep the user engaged during the occasionally long first-run setup.
6.  **Optimized NPM Flags**: Switched to `--no-package-lock` and `--no-update-notifier` to further reduce network activity and CPU usage during the bootstrap phase.

### Changes
-   Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    -   Refactored the bootstrap block to use `localClaudeBin`.
    -   Updated `runClaude` to accept a dynamic command path.
    -   Injected `NPM_CONFIG_CACHE` into the environment.
    -   Updated the `FRIENDLY_MESSAGES` array.

### Rationale
-   **User Experience**: Clearly communicates that the first-run installation is a one-time setup, reducing anxiety about the "stuck" state.
-   **Reliability**: By installing locally to a persistent home directory, we avoid common permissions issues with global `-g` installs in containerized environments.
-   **Self-Healing**: If the local install fails, the system still gracefully falls back to `npx`, but it does so with a persistent cache to speed up the process.

## GitHub Export Functionality (2026-03-31)

### Problem
Users wanted a way to export their generated code to a GitHub repository for further development, hosting, or version control. Previously, the code was only available within the Daytona sandbox.

### Solution
Implemented a "Export to GitHub" feature that pushes the generated project directly from the Daytona sandbox to a user-specified GitHub repository.

### Key Integration Points
1.  **Backend API (`/api/export-github`)**: 
    - Verifies user ownership and sandbox state.
    - Uses **Octokit** to authenticate with GitHub and create the repository if it doesn't already exist.
    - Triggers a Git push sequence within the Daytona sandbox using the user's Personal Access Token (PAT).
2.  **Frontend UI**:
    - Added an "Export to GitHub" button in the generation page's preview toolbar.
    - Implemented a `ExportGithubModal` to collect the GitHub PAT and desired repository name.
    - Uses `localStorage` to securely persist the PAT on the user's browser for future exports.
3.  **Database Persistence**:
    - Added `github_repo` and `github_url` columns to the `projects` table to track exported links.

### Rationale
-   **Direct Push**: Executing the Git operations within the sandbox itself is much more efficient than downloading all files to the Next.js server and then uploading them to GitHub. It handles large projects and binary files natively.
-   **User Privacy**: By asking for a PAT and storing it in `localStorage`, we avoid storing sensitive third-party credentials on our own servers.
-   **Seamless Flow**: The integration automatically creates the repo if missing, making the export a "one-click" experience for most users after initial setup.

## Fixing Model Selection and Broken Worker Script (2026-03-31)

### Problem
The agent was consistently defaulting to Anthropic Claude models (specifically Sonnet or Opus) regardless of the model selected on the landing page (e.g., Gemini 3 Flash). Furthermore, the worker script was logically broken due to an undefined `args` variable, causing the Claude Code agent to fail or run without arguments.

### Solution
1. **Explicit Model Flag**: Updated the `runClaude` function in `lovable-ui/app/api/generate-daytona/route.ts` to explicitly pass the `--model` flag to the Claude Code CLI.
2. **Defined Args**: Fixed the `ReferenceError: args is not defined` by properly initializing the `args` array with the prompt and necessary operational flags (`-p`, `--model`, `-y`).
3. **API Compatibility**: Updated the `ANTHROPIC_BASE_URL` for OpenRouter from `https://openrouter.ai/api` to `https://openrouter.ai/api/v1` to ensure full compatibility with the Anthropic SDK used by the CLI.
4. **Environment Consistency**: Added `ANTHROPIC_MODEL` to the environment variables passed to the worker as an additional layer of model enforcement.

### Rationale
- **Model Control**: Without the `--model` flag, specialized CLI agents like `claude-code` will fall back to their internal defaults (typically Sonnet 3.5), ignoring global environment variables.
- **Robustness**: Defining the `args` variable ensures the agent receives its instructions and can execute autonomously without manual intervention.

## Product Rebrand: Lovabee (2026-04-01)

### Problem
The application was using placeholder names like "Lovable Clone", "Lovable", and "Lovaclone" throughout the codebase, which lacked brand identity and a cohesive product vision.

### Solution
Executed a comprehensive global rebranding to **Lovabee**.

### Changes
1. **Brand Identity**: Replaced all user-facing names ("Lovable", "Lovable Clone") with "Lovabee" across all pages, including the `Navbar`, `Hero Section` in `app/page.tsx`, and the generation page headers.
2. **Metadata**: Updated the site's default HTML title tag in `app/layout.tsx` to reflect the new brand for better SEO and tab identification.
3. **Agent Persona**: Updated the internal backend agent (`generate-daytona/route.ts`) to adopt the Lovabee persona in its real-time progress updates ("Lovabee Agent is thinking...").
4. **Third-Party Integrations**: Updated the GitHub export configuration so that commits are made by "Lovabee Agent" and the default export descriptions highlight the "Lovabee" tool.
5. **System Configuration**: Updated the root `package.json` package name and internal domain references (like `SITE_URL`) to use `lovabee.vercel.app` formatting.
6. **Design Language**: Upgraded the generic blue/purple UI palette to a thematic 'Amber & Yellow' palette. Changed the avatar to a black 'B' on amber, and reshaped the gradient logo into a hexagon.

### Rationale
- **Product Legitimacy**: Establishing a unique name helps transition a project from a "clone" into a standalone, recognizable product. "Lovabee" introduces a charming, memorable identity while keeping the recognizable "Lov" prefix.
- **Consistency**: Changing this across the backend, frontend, metadata, and even Git commits ensures a polished and professional feel.
- **Brand Theming**: The amber, hexagonal, and bee-themed emojis significantly boost the 'finesse' and cohesiveness of the application's design system compared to standard blue defaults.

## Fixing Claude Code Unknown Option Error (2026-04-01)

### Problem
The Daytona worker was failing with a `[Claude STDERR]: error: unknown option '-y'` error. Claude Code updated its CLI parameter for bypassing permissions from `-y` to `--dangerously-skip-permissions`, causing the generation jobs to crash during the autonomous execution phase.

### Solution
Updated the `lovable-ui/app/api/generate-daytona/route.ts` API route to pass the correct `--dangerously-skip-permissions` flag instead of `-y` in the spawned worker script argument list.

### Rationale
-   **API Contract**: Aligning the flags passed to `claude-code` via `npx` with the actual expected flags to ensure autonomous, non-interactive environments don't crash from argument parsing errors.

## Fixing Stuck Navbar Skeleton Loader (2026-04-01)

### Problem
The Navbar would frequently get stuck in a skeleton loader state, particularly for authenticated users. This forced users to manually clear browser data to restore functionality. Investigation revealed that the `isLoading` state was blocked by an `await` on the `fetchCredits` function, which queried the Supabase `profiles` table. If this query took too long or hung, the entire Navbar auth UI remained hidden behind the skeleton placeholder.

### Solution
Hardened the `Navbar` auth initialization to be non-blocking and self-correcting:
1.  **Decoupled Credit Fetching**: Removed the `await` from `fetchCredits` calls within the auth lifecycle. The Navbar now transitions from `isLoading: true` to `false` as soon as the `user` object (or null) is returned by Supabase, regardless of whether the credits have finished loading.
2.  **Safety Timeout**: Added a 4000ms `setTimeout` within the `useEffect` hook that forces `setIsLoading(false)` if the auth check takes too long. This ensures that even in cases of corrupted local storage or network hangs, the user is eventually presented with the login/dashboard buttons.
3.  **Unified State Clearing**: Ensured that `setIsLoading(false)` is called in all logical branches of `initializeAuth` and the `onAuthStateChange` listener.

### Changes
-   Modified `lovable-ui/components/Navbar.tsx`:
    -   Refactored `initializeAuth` and `onAuthStateChange` to remove blocking `await` on credits.
    -   Implemented a 4-second safety timeout for the loading state.
    -   Cleaned up `useEffect` dependencies to prevent redundant re-runs.

### Rationale
-   **User Experience**: A missing credit counter is a minor missing feature, but a missing Login/Dashboard button is a critical "app is broken" failure. Prioritizing the core navigation UI over secondary data (credits) improves perceived reliability.
-   **Robustness**: The safety timeout addresses the "stuck" state reported by users when Supabase's internal session refresh logic might hang due to browser state issues.

## Switching to OpenHands-AI for Multi-Model & MCP Support (2026-04-01)

### Problem
The Claude Code CLI integration was too restrictive, failing on non-Anthropic models (like Gemini) due to strict internal validation. Additionally, it lacked a native way to integrate custom "skills" or MCP servers.

### Solution
Replaced **Claude Code** with **OpenHands-AI** as the primary agent engine.

### Key Points
1. **True Multi-Model**: OpenHands uses LiteLLM, allowing any OpenRouter model (Gemini, Llama, GPT) to be used without crashes.
2. **Fast Bootstrap**: Introduced **`uv`** as the Python package manager in the sandbox, reducing OpenHands installation time significantly.
3. **Enhanced Skills**: Expanded the `CLAUDE.md` rules inside the sandbox to include "Agentic Skills" for React (feature-based architecture), Vite (preview optimization), Tailwind (premium aesthetics), and Git (atomic commits).
4. **MCP Ready**: The new engine is natively compatible with the Model Context Protocol, enabling easy expansion of the agent's toolkit in future iterations.

### Rationale
- **Flexibility**: Users can now leverage the best model for their specific task (e.g., Gemini for speed, Sonnet for complexity).
- **Extensibility**: Native MCP support removes the "black box" nature of the previous agent.
- **Performance**: Despite being a heavier agent, `uv` ensures the bootstrap process remains snappy in the Daytona sandbox.

## Fixing worker.mjs Path Resolution in API Route (2026-04-01)

### Problem
The application was failing intermittently with `ENOENT: no such file or directory` when attempting to read the `worker.mjs` script in the `/api/generate-daytona` route. The error logs revealed that the path resolution was redundantly nesting directory names (e.g., `/var/task/lovable-ui/lovable-clone/lovable-ui/...`), suggesting that `process.cwd()` already contained the project root, but the code was adding it again.

### Solution
Simplified the `workerPath` resolution in `lovable-ui/app/api/generate-daytona/route.ts`. Instead of hardcoding the relative path from a presumed parent directory, it now uses a path relative to the current working directory, which is more reliable across both local and Vercel/serverless environments.

### Changes
- Modified `lovable-ui/app/api/generate-daytona/route.ts`:
    - Changed `path.join(process.cwd(), "lovable-clone/lovable-ui/app/api/generate-daytona/worker.mjs")` to `path.join(process.cwd(), "app/api/generate-daytona/worker.mjs")`.

### Rationale
- **Environment Consistency**: In most deployment environments (like Vercel), `process.cwd()` points to the project root. Adding redundant project-name segments is a common source of `ENOENT` errors.
- **Portability**: This change makes the code more portable, allowing it to run correctly whether the project is at the root of the workspace or nested within other folders, as long as it's being executed from the `lovable-ui` directory.

## Fixing Escaped Template Literals in worker.mjs (2026-04-01)

### Problem
The `worker.mjs` script was failing in the Daytona sandbox with errors like `/bin/sh: 1: --headless: not found`. Investigation revealed that many variables in the script were escaped (e.g., `\${command}` instead of `${command}`). This happened because the script was likely extracted from a `String.raw` template literal in a previous session, but the escape backslashes were preserved in the standalone ESM file. This caused the shell to receive literal `${variable}` strings, which evaluated to empty, leaving the command malformed.

### Solution
Performed a global cleanup of `worker.mjs` to remove all backslash escapes from template literals. Also corrected the `ROBUST_PATH` definition to use literal `$` symbols for shell environment variable expansion.

### Changes
- Modified `lovable-ui/app/api/generate-daytona/worker.mjs`:
    - Removed `\` from all `${...}` occurrences.
    - Updated `ROBUST_PATH` to use `$HOME` and `$PATH` correctly.

### Rationale
- **JS Execution**: In a standalone `.mjs` file, template literals are standard syntax and must not have backslashes before the `${` if interpolation is desired.
- **Shell Compatibility**: Ensuring the commands constructed for `spawn` and `execSync` have the actual values (like the path to the `openhands` binary) is critical for the agent loop to function in the sandbox.

## Fix Daytona uv Agent Stuck Issue (2026-04-01)

### Problem
The `uv` installer via `curl | sh` was hanging indefinitely in the Daytona environment due to IPv6 DNS blackholes.

### Solution
- Replaced the curl | sh installer with a direct binary download and a fallback to apt-get + pip-installed uv.
- Removed --python 3.12 from uv venv invocation to prevent uv from attempting standalone python downloads.

## URL Structure Change and Project Creation Logic (2026-04-01)

### Problem
The application previously used a flat URL structure for generation (`/generate?prompt=...`), which made it difficult to link back to specific projects.

### Solution
Implemented a dynamic routing structure and a dedicated project creation API:
1.  **Dynamic Route**: Moved the generation page from `app/generate/page.tsx` to `app/generate/[projectId]/page.tsx`.
2.  **Dedicated API**: Created `app/api/projects/route.ts` to handle initial project record creation (POST).
3.  **Handoff Logic**: Updated the home page to create a project first, then redirect.

### Rationale
-   **Clean URLs**: `/generate/:projectId` is more standard and intuitive.
-   **Separation of Concerns**: Decoupling project creation from generation allows for better state management.

## Fixing OpenHands SDK Conversation Initialization (2026-04-01)

### Problem
The OpenHands SDK runner crashed with `'sid'` unexpected keyword argument.

### Solution
- **Factory Pattern**: Refactored `agent_runner.py` to use `Conversation.create()`.
- **Keyword Mapping**: Changed `conversation_id` to `id`.

## Correcting OpenHands SDK Installation Robustness (2026-04-01)

### Problem
The worker was installing the wrong package (`openhands` instead of `openhands-sdk`).

### Solution
- **Package Correction**: Updated `worker.mjs` to target `openhands-sdk==1.16.0`.
- **Introspection**: Added `safe_create_conversation` with `inspect.signature` support.

## Fixing Conversation UUID Type Error (2026-04-01)

### Problem
The SDK expected a `uuid.UUID` object but received a string.

### Solution
- **Type Casting**: Updated `agent_runner.py` to cast or generate a deterministic UUID using `uuid.uuid5`.

## OpenHands Event-Driven Progress Updates (2026-04-02)

### Problem
The Lovabee agent was a "black box" during execution, displaying generic looping messages while the real work (writing files, running commands) was hidden.

### Solution
Transitioned to an event-driven progress system:
1.  **Event Stream**: Modified `agent_runner.py` to subscribe to the OpenHands `event_stream`, capturing `ActionEvent` and `ObservationEvent`.
2.  **Granular Logging**: The runner now emits JSON events for every tool use and result.
3.  **Frontend Integration**: Updated the worker to forward these events to the UI, suppressing generic messages during active work.

### Rationale
-   **Transparency**: Users can now see exactly what the agent is doing (e.g., "Writing index.tsx").
-   **Trust**: Real-time feedback significantly improves the perceived reliability of the agent.

## Polling Fallback for Realtime Synchronization (2026-04-02)

### Problem
The Supabase Realtime WebSocket connection frequently timed out or returned `CHANNEL_ERROR` during long-running tasks. This caused the UI to stop updating even if the worker was still active.

### Solution
Implemented a redundant message synchronization system:
1.  **Deduplicated State**: Introduced `seenMessageIds` tracking.
2.  **Polling Fallback**: Added a 5-second polling interval as a safety net.
3.  **Non-Fatal Subscription**: Refactored the Realtime subscriber to be advisory only.

### Rationale
-   **Reliability**: Projects can now survive transient network issues or Realtime outages.

## Terminating Zombie Workers to Prevent 401 Token Errors (2026-04-02)

### Problem
Hitting "Retry" generated a new `webhook_token`, but the old worker process remained active, sending updates with stale tokens that resulted in 401 Unauthorized errors.

### Solution
Implemented mandatory session cleanup in `app/api/generate-daytona/route.ts`:
1.  **Session Purge**: Added `sandbox.process.deleteSession(sessionId)` before starting a new worker.
2.  **Deterministic ID**: Ensures any previous process for the same project is explicitly terminated.

### Rationale
-   **Security**: Prevents unauthorized updates from old processes.
-   **Stability**: Eliminates log interleaving and flickering status updates.

## Robust Project Structure Detection and Flattening (2026-04-02)

### Problem
Agents often initialize projects in subdirectories (e.g., `jordan-blog/`) despite rules to use the current directory. This caused the worker to fail its `package.json` validation, leading to false "Worker Silent Failure" reports and preventing the dev server from starting correctly.

### Solution
Implemented a multi-layered stabilization in `worker.mjs`:
1.  **Recursive Search**: Added `findPackageJson` to locate the project root up to 2 levels deep.
2.  **Automatic Flattening**: Added `flattenProject` to move all files from a detected subdirectory to the workspace root (`/home/daytona/website-project`).
3.  **Dynamic Dev Server**: Updated the preview logic to inspect `package.json` scripts, choosing between `next dev` and `vite` and enforcing `--hostname 0.0.0.0` for external accessibility.
4.  **Zombie Prevention**: Added explicit `process.exit()` and `clearInterval()` calls to ensure the worker completely stops after sending "complete" or "error" signals, preventing stale token 401 errors.

### Rationale
-   **Resilience**: The system now handles various agent initialization patterns without manual intervention.
-   **Preview Accuracy**: Ensures the dev server always starts in the correct directory with proper network binding.
-   **Resource Management**: Prevents background resource leakage in the Daytona sandbox.
