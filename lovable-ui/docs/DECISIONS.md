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
-   **Default Model Update**: `gpt-5.3-codex` was a placeholder; `gpt-4o` is a standard, reliable default for code generation.
