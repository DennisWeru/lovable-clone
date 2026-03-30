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
4.  **Backend Consistency**: Updated default model to `openai/gpt-4o-2024-08-06` (from the non-existent `gpt-5.3-codex`) across `app/generate/page.tsx` and `app/api/generate-daytona/route.ts`.

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
