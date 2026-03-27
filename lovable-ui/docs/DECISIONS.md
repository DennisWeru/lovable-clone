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
