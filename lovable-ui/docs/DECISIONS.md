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
