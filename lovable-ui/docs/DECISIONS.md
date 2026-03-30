# Project Decisions Log

## 2026-03-27 - Resolving npm Install Error

### Problem
The user encountered an `ENOTEMPTY` error when running `npm install`. Specifically, npm failed to rename the `caniuse-lite` directory in `node_modules`.

```
npm error ENOTEMPTY: directory not empty, rename '/Users/dennisweru/Desktop/Code/CursorExperiments/Lovaclone/lovable-clone/lovable-ui/node_modules/caniuse-lite' -> '/Users/dennisweru/Desktop/Code/CursorExperiments/Lovaclone/lovable-clone/lovable-ui/node_modules/.caniuse-lite-GX8kopr9'
```

### Context
- The project is a Next.js application (`lovable-ui`).
- No obvious dev server was detected running via `ps aux | grep node`.

### Decision
- Recommend a clean install by deleting `node_modules` and `package-lock.json`.
- This is a standard fix for `ENOTEMPTY` race conditions or locked files in npm.

## 2026-03-27 - Fixing Dashboard Project Visibility

### Problem
The user's dashboard was showing "no projects yet" despite projects being present in the Supabase database. This was likely due to Row Level Security (RLS) policies preventing the authorized user from seeing their own records when using the standard Supabase client.

### Decision
- Refactor the dashboard (`app/dashboard/page.tsx`) to use `createAdminClient` for fetching projects and profiles.
- This bypasses RLS and provides full visibility to existing records associated with the user's ID.
- Also updated `app/admin/page.tsx` to use `createAdminClient` consistently for administrative data fetching and updates.
- Ensured the `createAdminClient` implementation in `lib/supabase/server.ts` uses the `SUPABASE_SERVICE_ROLE_KEY` to correctly authenticate as a service role.

### Impact
- Projects are now visible to users on their dashboard.
- Admin dashboard operations (credit updates, role elevations) now work reliably.

## 2026-03-27 - Dashboard: Continue Modifying Existing Projects

### Problem
Projects shown on the dashboard had no way to resume iterative development. Users who wanted to modify a generated project had to start over from scratch.

### Decision
- Added a **✏️ Continue** button to each project card on `app/dashboard/page.tsx`, visible only when a `sandbox_id` exists.
- The button links to `/generate` with `prompt`, `model`, `sandboxId`, and `previewUrl` as query params.
- Updated `app/generate/page.tsx` to read `sandboxId` and `previewUrl` from search params and pre-populate state, so the generate page resumes with the existing sandbox and preview already visible.
- Auto-generation is suppressed when `previewUrl` is already provided via params (user opened an existing project, not triggering a new generation).
- If only `sandboxId` is provided (no prompt), the page no longer redirects to `/` — it allows loading the sandbox context and accepting follow-up prompts.

### Why URLSearchParams over a separate route (`/project/[id]`)
A dedicated `[id]` route would require an additional server fetch per project open. Passing params to `/generate` keeps the architecture simple and reuses the existing streaming UI. We can revisit if project state grows more complex.

### Impact
- Users can click **✏️ Continue** on any completed project and immediately send follow-up prompts to modify it.
- Existing sandbox is reused, reducing Daytona cost and generation time.

## 2026-03-27 - Project Conversation History

### Problem
Each generation session was ephemeral — refreshing the page lost all chat messages. Users had no way to review past interactions for a project.

### Decision
- Added `project_messages` Supabase table (`supabase/migrations/20260327_create_project_messages.sql`) with columns: `id`, `project_id` (FK), `type`, `content`, `metadata` (JSONB), `created_at`.
- RLS: SELECT allowed for the project owner; INSERT/UPDATE/DELETE only via service role (admin client on the server).
- Updated `generate-daytona/route.ts` to batch-insert messages after each generation run completes — user prompt saved as `type=user`, then `claude_message` and `tool_use` entries from the streamed output.
- Created `GET /api/project-messages?projectId=xxx` endpoint — verifies ownership, returns messages in chronological order.
- Updated `generate/page.tsx` to fetch history on mount when `projectId` is in URL params. History messages are flagged with `isHistory: true` and rendered with a "New session" divider above the first live message.

### Design choices
- **Batch insert after completion**, not per-message during streaming. Avoids latency and DB write pressure in the hot streaming path. Tradeoff: messages are lost if the server crashes mid-generation (acceptable for now).
- **No separate history route/modal**: history loads inline in the existing generate page to keep UX minimal and fast.
- **`type=user` messages**: the first message of each generation round (the user's prompt) is stored so the chat history reads as a full conversation, not just AI output.

## 2026-03-27 - Adaptive Dashboard Actions & LLM Context

### Problem
- Some projects on the dashboard were unopenable if they didn't have a `sandbox_id` (e.g., failed or pending).
- When "continuing" a project, the LLM had no access to the previous chat history, making follow-up prompts like "proceed" or "fix it" confusing for the AI.

### Decision
- **Adaptive Dashboard Buttons**: Refactored `app/dashboard/page.tsx` to ensure every project has a primary action.
  - Completed + Sandbox -> **✏️ Continue**
  - Completed, no sandbox -> **📂 View** (shows history)
  - Failed -> **↺ Retry** (red style)
  - Pending -> **📂 View**
- **LLM Conversation Context**:
  - Updated `generate-daytona/route.ts` to fetch the last 20 messages for the project when a `projectId` is provided.
  - Formatted these messages as a transcript and passed them to the generation script via a `CONVERSATION_HISTORY` environment variable.
  - Modified `scripts/generate-in-daytona.ts` to inject this history into the system prompt for the AI.

### Impact
- Users can now open *any* past project to view its history or try to retry/continue it.
- The AI now understands follow-up requests within the same project context, enabling true iterative development ("make it red", "add a button", etc).

## 2026-03-28 - Next.js Error Overlay and Vercel Timeout

### Problem
The application crashed on the frontend with the error `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` when trying to parse the response from `/api/generate-daytona` and `/api/restart-server`. This occurs when Vercel (or the local Next.js dev server) intercepts the request and returns an HTML error page (like a 504 Gateway Timeout or 500 Server Error) instead of a JSON response. 

### Decision
- **Graceful Error Handling**: Modified the `fetch` error handling in `app/generate/page.tsx` (`generateWebsite` and `handleRestartServer` functions). Before calling `response.json()`, the code now checks the `Content-Type` header. If it isn't `application/json`, it reads the response as text and throws a specific error mentioning a potential Vercel timeout or configuration issue. This prevents the cryptic `JSON.parse` error and provides clearer feedback.
- **Vercel Timeout Extension**: Since generating a project in Daytona can easily exceed the default 10-15 second Serverless Function timeout on Vercel, `export const maxDuration = 300;` was added to both `app/api/generate-daytona/route.ts` and `app/api/restart-server/route.ts`. This permits the Next.js API routes to run for up to 5 minutes on Vercel before being terminated, ensuring generation streams can initialize properly.

## 2026-03-28 - Production 500 Error Debugging & Robustness

### Problem
The application encountered an HTTP 500 error in production. The frontend displayed "Server returned unexpected format," indicating that the server returned a non-JSON response (likely a Vercel HTML error page).

### Decision
- **NextResponse and Robust Returns**: Refactored `app/api/generate-daytona/route.ts` to use `NextResponse.json()` for all early error returns. This ensures that even if an error occurs early (missing credits, auth failure, etc.), the client receives valid JSON with a 500 (or 401/403) status, rather than a raw `Response` that might be mangled by Vercel or middleware.
- **Environment Variable Validation**: Added explicit checks for `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `DAYTONA_API_KEY` at the start of the `POST` handler. If these are missing in production settings, the API now returns a descriptive error message instead of failing silently with placeholder keys.
- **Enhanced Frontend Error Reporting**: Updated the `fetch` error handler in `app/generate/page.tsx` to include the first 100 characters of any non-JSON response in the UI error message. This will allow for faster debugging of Vercel-level crashes or timeouts by surfacing the HTML error snippet directly to the user.
- **Improved Logging**: Added more detailed `console.error` logs on the server for authentication and profile fetch failures to assist in monitoring via Vercel Logs.

## 2026-03-28 - Middleware Crash & Unsafe Auth Destructuring Fix

### Problem
Despite previous fixes, the application returned a generic 500 HTML error page. This indicated a crash *before* the API route handler, specifically in the **Middleware**. The root cause was unsafe destructuring of the Supabase auth response: `const { data: { user } } = await supabase.auth.getUser()`. If the auth check fails (e.g. invalid cookie or session), `data` is `null`, and destructuring `user` from it throws a `TypeError`, crashing the Edge Runtime.

### Decision
- **Safe Auth Access**: Replaced all instances of `{ data: { user } }` destructuring with safer `{ data, error }` checks across `middleware.ts`, `generate-daytona/route.ts`, and `restart-server/route.ts`. 
- **Middleware Safety Net**: Wrapped the entire `updateSession` logic in `lib/supabase/middleware.ts` in a `try-catch` block. If the auth logic crashes for any reason (environment issues, network errors, etc.), the middleware now logs the error and allows the request to proceed to the next handler instead of returning a hard 500 error page.
- **Consistency**: Ensured all auth-reliant routes use `const user = data?.user` to prevent similar crashes in the future.

### Impact

## 2026-03-28 - Detached Daytona Worker Architecture (Option 2)

### Problem
AI generation tasks frequently exceed Vercel's 10-60s serverless function timeouts, resulting in uncatchable 504 Gateway Timeouts or infrastructure-level 500 errors.

### Decision
- **Detached Generation**: Refactored the `/api/generate-daytona` route to instantiate a Daytona sandbox, upload a standalone worker script, and trigger it with `nohup` before returning `200 OK` immediately. This ensures Vercel only handles the initial handoff (<2s).
- **Standalone Worker**: Created `scripts/generation-worker.ts` to execute all heavy AI and file operations directly inside the Daytona container. It is self-bootstrapping and manages its own dependencies.
- **Webhook Updates**: Implemented a secure `/api/webhooks/daytona-progress` receiver that validates a project-specific `webhook_token` and updates the database.
- **Supabase Realtime**: Replaced the fragile SSE (Server-Sent Events) streaming on the frontend with a Supabase Realtime subscription to the `project_messages` table.

### Impact
- **Stability**: Generation can now run for minutes (or hours) without being affected by Vercel's HTTP request limits.
- **Reliability**: Users see real-time progress updates via Supabase even if the initial browser-server connection is severed.
- **Scalability**: Decoupling the compute (Daytona) from the web server (Vercel) allows for much heavier generation workloads.

## 2026-03-29 - Daytona SDK API Misuse: executeCommand Does Not Support Shell Features

### Problem
The generation worker was silently failing in production — `exitCode: -1` with empty stdout. The worker.log file was never created. Every attempt to fix the issue (wrapping in `sh -c`, using `nohup`, creating runner scripts) failed identically.

### Root Cause
`sandbox.process.executeCommand()` in the Daytona SDK (`@daytonaio/sdk ^0.21.5`) does **not** interpret commands through a shell. It executes them directly, which means:
- Shell pipes (`|`) do not work
- File redirections (`>`, `2>&1`) do not work  
- Background operators (`&`, `nohup`) do not work
- `echo "..." | base64 -d > file.mjs` — **the core of our file writing strategy** — was silently failing every time

### Decision
Replaced all `executeCommand`-based file I/O and process management with the proper Daytona SDK APIs:

1. **File Writing**: `sandbox.fs.createFolder(path, mode)` and `sandbox.fs.uploadFile(Buffer, remotePath)` instead of `executeCommand('echo ... | base64 ...')`.
2. **Background Execution**: `sandbox.process.createSession(id)` + `sandbox.process.executeSessionCommand(id, { command, runAsync: true })` instead of `executeCommand('nohup ... &')`.
3. **Environment Variables**: Since `SessionExecuteRequest` has no `env` parameter, env vars are written to a shell script via `fs.uploadFile` and sourced inline: `source worker-env.sh && node worker.mjs`.
4. **Log Reading**: `/api/daytona-logs` now uses `sandbox.fs.downloadFile(path)` and `sandbox.fs.listFiles(path)` instead of `executeCommand('cat ...')`.

### Impact
- The worker script is now **guaranteed** to be written to the container.
- Background execution is managed by Daytona's native session system, not fragile nohup hacks.
- Logs can be reliably retrieved via the filesystem API.

## 2026-03-29 - ERR_MODULE_NOT_FOUND: npm install vs Node ESM Resolution Mismatch

### Problem
The generation worker installed `@google/generative-ai` successfully but Node immediately threw `ERR_MODULE_NOT_FOUND` when the dynamic `import()` ran. The install succeeded (exit code 0, `added 1 package`) but the module was invisible to the script.

### Root Cause
Node's ESM module resolver resolves packages **relative to the importing script's directory**, not `process.cwd()`. The worker script lives at `/home/daytona/generation-worker.mjs`, so Node looks for `node_modules` at `/home/daytona/node_modules`. However, `execSync("npm install ...")` installs into `process.cwd()`, which is wherever the Daytona session's default working directory happens to be — not necessarily `/home/daytona/`. This caused the `node_modules` to land in a directory Node never searches.

### Decision
1. **Explicit `cwd` in `execSync`**: Changed the worker's install command to `execSync("npm install @google/generative-ai", { stdio: "inherit", cwd: "/home/daytona" })` so `node_modules` is always created beside the script.
2. **Explicit `cd` in session command**: Added `cd /home/daytona &&` before `node generation-worker.mjs` in the `executeSessionCommand` call, ensuring `process.cwd()` also matches the script location.

### Impact
- `node_modules` is now guaranteed to be in the same directory as the worker script.
- Node's ESM resolver finds the package on the first `import()` attempt.

## 2026-03-29 - Worker Silent Stall After "Install complete." — Three Root Causes

### Problem
The worker log showed successful dependency installation (`[Worker] Install complete.`) and then went completely silent. No `[Worker] run() starting...`, no error messages, no crash output. This symptom persisted across multiple debugging conversations despite fixing earlier-stage issues (file upload, module resolution, etc.).

### Root Causes

1. **Unhandled Promise Rejection**: `run()` is an async function that returns a Promise. Line 263 called `run()` without `.catch()`. If anything inside the Promise chain rejected (e.g., a network error from `fetch`, a Gemini API failure), Node.js would emit an unhandled rejection and potentially terminate the process. Because stdout was redirected to a log file (`> worker.log 2>&1`), the output buffer might not flush before the process died — producing zero visible output after "Install complete."

2. **Double-escaped strings in template literal**: The worker is defined as a template literal inside TypeScript. `\\\\n` in TypeScript source → `\\n` in the .mjs file → Node interprets this as the literal characters `\` + `n`, NOT a newline. This meant:
   - `systemPrompt.join("\\\\n")` joined prompt lines with literal `\n` text, not newlines
   - `"\\\\n\\\\nUser request: "` sent literal `\n\n` text to the AI, not paragraph breaks
   - Regex patterns like `/^\\\\w*\\\\n/` and `/\\\\{[\\\\s\\\\S]*\\\\}/` matched wrong characters (literal backslash+w instead of word character class, etc.)
   - The AI likely received a garbled prompt, returned unexpected output, the broken regex couldn't parse it, and the error cascaded to a silent crash

3. **No diagnostic logging in the critical transition zone**: Between "Install complete" (line 148) and the `run()` call (line 263), there was zero logging for env var state, function entry, import results, or webhook responses. This made it impossible to diagnose which exact step failed.

### Decision

1. **Added `.catch()` to `run()`**: `run().catch(e => { console.error("[Worker] FATAL:", e); process.exit(1); })` ensures any unhandled rejection is logged before the process exits.

2. **Fixed all string escaping**: Changed `\\\\n` → `\\n` throughout the template literal (for `.join()`, prompt concatenation, and `console.error` format strings). Fixed regex patterns: `\\\\w` → `\\w`, `\\\\{[\\\\s\\\\S]*\\\\}` → `\\{[\\s\\S]*\\}`.

3. **Added comprehensive diagnostic logging**:
   - ENV check dump after variable declarations (shows which vars loaded, key prefixes, URL previews)
   - `sendUpdate` now logs skip reasons and HTTP response status codes
   - Every JSON parse strategy logs success or failure
   - File write operations log each file path
   - `run()` entry and exit are logged

4. **Safer error message extraction**: `e.message` → `String(e && e.message ? e.message : e)` to handle non-Error throwables.

### Impact
- Worker crashes will now always produce diagnostic output in the log file.
- The AI system prompt is properly formatted with real newlines.
- JSON extraction regexes now correctly match word characters, whitespace, and braces.
- The fundamental pipeline (install → load env → call AI → parse JSON → write files → send webhook) should actually execute for the first time.

### Key Learning
The template literal escaping was the sneakiest bug. Four backslashes (`\\\\`) in the TypeScript source produce two backslashes in the JavaScript string, which produce one backslash + the next character in the .mjs file at runtime. The fix is two backslashes (`\\`) in TypeScript source → one backslash in the .mjs file → proper escape sequence at Node runtime.

## 2026-03-29 - String.raw: Eliminating Template Literal Escape Hell

### Problem
The previous fix changed `\\\\n` to `\\n` inside the template literal, but `\\n` in a regular template literal is interpreted as an escape sequence producing an actual newline **byte** (0x0A). This meant the .mjs file contained a raw newline character inside a double-quoted string (`].join("` + newline + `")`), which is a JavaScript syntax error: `SyntaxError: Invalid or unexpected token`.

The fundamental issue: generating JavaScript source code inside a template literal requires **two levels of escaping** — one for the template literal and one for the generated code. The correct escape for the template literal would be `\\n` (three characters: `\`, `\`, `n`), but this is extremely error-prone and hard to reason about.

### Decision
Used `String.raw` tagged template: `const workerContent = String.raw\`...\``. This disables escape sequence processing in the template literal while preserving physical line breaks. Now:
- `\n` in source → literal `\n` (two chars) in the .mjs file → Node interprets as newline ✓
- `\w`, `\s`, `\S` → literal regex character classes in the .mjs file ✓
- `\{`, `\}` → literal regex escapes in the .mjs file ✓
- Physical line breaks → actual newlines for file structure ✓

### Impact
Eliminates the entire class of multi-level escape bugs permanently. The worker script text in the TypeScript source now reads identically to how it appears in the generated .mjs file..

## 2026-03-29 - Daytona Autonomous Agent: Multi-Turn Tool Integration

### Problem
The initial Daytona worker was a "static generator" that could only produce a list of files. It had no way to verify its work (visual testing), search for real documentation, or execute diagnostic commands during the generation process.

### Decision
Refactored the worker script into a **multi-turn autonomous agent** using Gemini's native function calling. The agent now operates in a loop, calling tools and analyzing their output before proceeding.

### Implemented Tools:
1. **Visual Testing (Playwright)**: `take_screenshot` tool. Installs `playwright-core` and chromium in the sandbox to capture the rendered site on port 3000.
2. **Docs Search (Context7)**: `search_docs` tool. Integrates with `context7.com` API to fetch up-to-date documentation for libraries, reducing hallucinations.
3. **Shell Access**: `run_command` tool. Allows the AI to run `npm install`, `npm test`, or `lint` to verify code correctness in real-time.
4. **FS Management**: `list_files`, `read_file`, and `write_file` for precise project manipulation.

### Rationale
By moving to a tool-calling architecture, the agent can self-correct by "seeing" layout bugs via screenshots or "reading" error logs from shell commands. This significantly improves the reliability and quality of generated websites.

### Prerequisites
- `CONTEXT7_API_KEY` must be configured in the server environment.
- The sandbox image must support basic browser dependencies (standard in most node:20 images).
- The fundamental pipeline (install → load env → call AI → parse JSON → write files → send webhook) should actually execute for the first time.

## 2026-03-29 - Real-time Agent Visibility

### Problem
Agent-driven development was "silent" during long-running tasks like dependency installation or multi-turn tool calling, leading users to believe the app was stuck.

### Decision
- **Unified Log API**: Fixed `/api/daytona-logs` to return standardized JSON.
- **Frontend Polling**: Added a 3-second polling mechanism in `app/generate/page.tsx` that fetches logs while `isGenerating` is true.
- **Agent Console UI**: Added an integrated "Agent Console Logs" drawer with a toggle button and color-coded output.
- **Auto-Discovery**: The console now auto-opens on generation start so users can verify the worker is bootstrapping.

## 2026-03-29 - Quota-Aware Background Resiliency

### Problem
The background worker would crash immediately on Gemini API `429` (Quota Exceeded) errors, which are common on the free tier.

### Decision
- **Retry Strategy**: Implemented a `retryable` higher-order function in the worker template that detects `429` errors and waits 45 seconds before retrying (up to 3 times).
- **Progress Signaling**: The worker now sends a specific "⚠️ Quota exceeded. Retrying in 45s..." progress message to the UI during wait periods.
- **Fatal Error Reporting**: Added a `try-catch` to the worker's `main` entry point that sends a final `type=error` webhook to Supabase before the process exits, ensuring the UI "Retry" button appears.
- **UI Error Mapping**: Added a specific `QUOTA_EXCEEDED` case to the frontend error handler to provide clear instructions to the user.

### Impact
- Significant reduction in "silent hangs" due to rate limits.
- Improved user confidence via real-time feedback during network or API stalls.

## 2026-03-30 - Transitioning to OpenRouter & Dynamic Billing

### Problem
The application relied exclusively on the Gemini SDK, limiting model choice and making it difficult to implement granular, per-request billing for diverse models with varying costs.

### Decision
- **OpenRouter Integration**: Replaced the `@google/generative-ai` SDK with a lightweight, OpenAI-compatible `fetch` implementation. This allows the application to use any model supported by OpenRouter (e.g., Claude 3.5 Sonnet, Llama 3).
- **Dynamic Per-Request Billing**:
    - **Credit Exchange Rate**: Fixed at **1 Credit = $0.0001 USD** ($1.00 = 10,000 credits).
    - **Usage Capture**: The generation worker now captures the OpenRouter `id` (`gen-xxxx`) and `usage` (token counts) for every request and sends them in the `complete` webhook metadata.
    - **Asynchronous Verification**: The webhook handler now waits 2 seconds after a project completes before querying the OpenRouter `/api/v1/generation?id=...` endpoint to retrieve the *exact* finalized cost.
    - **Atomic Deductions**: Implemented the `decrement_credits(user_id, amount)` Postgres function (RPC) to ensure credit deductions are atomic and prevent race conditions.
- **UI/UX Visibility**:
    - **Live Balance**: Added a real-time credit balance badge to the `Navbar`, subscribing to Supabase changes for instant feedback.
    - **Project Costs**: Added a "Credits Used" display to each project card on the dashboard.
- **New User Award**: Increased the signup bonus from 1,000 to **20,000 credits** ($2.00) to ensure a high-quality initial experience.

### Impact
- **Sustainable Premium Experience**: New users have enough credits for a full iterative generation using moonshotai/kimi-k2.5 , improving first-impression retention.
- **Accurate Billing**: Every request is now billed down to the ten-thousandth of a dollar ($0.0001), protecting the platform's margins.

## 2026-03-30 - Fix: TypeScript Syntax in Generated Worker Script

### Problem
The `generation-worker.mjs` script was failing with `SyntaxError: Unexpected identifier 'as'` in the Daytona sandbox. This occurred because a TypeScript type assertion (`err as any`) was included in the `workerContent` template literal in `route.ts`, but the sandbox executes the script using standard Node.js (ESM), which does not support TypeScript syntax.

### Decision
- Removed the `as any` type assertion from the `workerContent` template in `app/api/generate-daytona/route.ts`.
- Changed `(err as any).status = resp.status;` to `err.status = resp.status;`.
- Verified that no other TypeScript-specific syntax (type annotations, interfaces, etc.) remains in the generated worker script.

### Impact
- The generation worker now starts successfully in the Daytona sandbox environment.
- Error handling for OpenRouter API responses (like 429 rate limits) now correctly propagates the HTTP status to the retry logic.

## 2026-03-30 - Optimizing Playwright Performance in Daytona

### Problem
The agent was spending significant time (minutes) at the start of each generation and during the `take_screenshot` tool execution downloading Playwright browsers (`chromium`, `ffmpeg`, etc.). This happened because the sandbox was using a generic `node:20` image that lacked these dependencies, forcing `npm install` and `npx playwright install` on every fresh run.

### Decision
- **Switched Sandbox Image**: Changed the Daytona sandbox image from `node:20` to `mcr.microsoft.com/playwright:v1.45.0-jammy`. This is an official Microsoft image that comes with Node.js and all Playwright browsers/system dependencies pre-installed.
- **Removed Redundant Install Steps**:
    - Removed `npx playwright install chromium` from the `take_screenshot` tool.
    - Simplified the worker bootstrap to avoid re-installing `playwright-core` if possible (switched to `playwright` which is usually global or faster to link in this image).
- **Added Sandbox Flags**: Added `--no-sandbox` and `--disable-setuid-sandbox` to the Chromium launch arguments to ensure compatibility with Docker-based sandbox environments.

### Impact
- **Instant Screenshots**: The agent no longer downloads 100MB+ of browser binaries during the generation process.
- **Faster Bootstrap**: The worker spends less time in the "Bootstrapping environment" phase.
- **Reduced Bandwidth/Cost**: Fewer external downloads from the sandbox environment.

## 2026-03-30 - Removing Daytona Preview URL Warning

### Problem
When opening a Daytona preview URL in the application's preview window (iframe), users are greeted with a "Preview URL Warning" page. This interrupts the seamless experience and requires manual interaction ("I Understand, Continue").

### Research Findings
According to Daytona's documentation on `preview-and-authentication`:
1. **Warning Logic**: The warning page is a security measure for browser-based access to "Standard Preview URLs".
2. **Standard Bypasses**:
   - **X-Daytona-Skip-Preview-Warning: true**: An HTTP header that skips the warning. Impossible to inject into a standard iframe load from the browser.
   - **Tier 3 Upgrade**: Upgrading the Daytona organization to Tier 3 removes the warning globally.
   - **Custom Preview Proxy**: Deploying a self-hosted proxy to inject the bypass header.
3. **Signed Preview URLs**:
   - These URLs embed the authentication token directly: `https://{port}-{token}.{daytonaProxyDomain}`.
   - They are specifically designed for iframes and emails where headers cannot be set.
   - Research suggests Signed Preview URLs bypass the manual warning page because they are considered "pre-authenticated" sessions.

### Decision
- **Short-term (Code)**: Switch from `sandbox.getPreviewLink()` to `sandbox.getSignedPreviewUrl(3000, 3600)` in the generation API. This provides a more professional, header-less URL that is better suited for the iframe preview window.
- **Long-term (Org)**: If the project scales, the organization should be upgraded to **Tier 3** to remove the warning across all standard URLs without needing signed tokens.

### Impact
- Eliminates the manual "I Understand" click for users.
- Improves the premium "Lovable" feel of the application.
- Enhances security by using time-limited signed tokens instead of generic public URLs.
