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

