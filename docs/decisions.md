# Design and Implementation Decisions

## Husky Pre-commit Hook Integration (2026-03-30)

### Decision
Add Husky pre-commit hooks at the repository root (`lovable-clone`) to enforce project health checks before commits.

### Rationale
To prevent potentially broken code from being committed to the repository, ensuring continuous integration standards locally.

### Plan
1. Install `husky` in the root `package.json`.
2. Initialize husky (`npx husky init`).
3. Add a `type-check` script to `lovable-ui/package.json`: `"type-check": "tsc --noEmit"`.
4. Configure the `.husky/pre-commit` hook to navigate into `lovable-ui` and run `npm run lint && npm run type-check && npm run build`.
5. Update `package.json` scripts if necessary.


## Default Technology Stack for Agent-Led Generation (2026-03-30)

### Decision
Update the autonomous agent's system prompt (in `lovable-ui/app/api/generate-daytona/route.ts`) to prefer React, Vite, and Tailwind CSS as the default web development stack for all project tasks. 

### Rationale
The agent was previously struggling with project initialization and had no predefined tech stack guidance, leading to inconsistent or failing results. Standardizing on React + Vite + Tailwind ensures a modern, robust, and familiar development environment, which the agent can better handle with specific instructions.

### Plan
1.  Update the worker's `systemMessage` with specific instructions for React/Vite initialization and Tailwind setup.
2.  Add strict rules to avoid common tool-calling errors (like using leading colons in shell commands).
3.  Instruct the agent to prioritize high-end design aesthetics in its creations.

## Hardening Claude Code Initialization in Sandbox (2026-04-01)

### Decision
Refined the Claude Code CLI (agentic mode) environment and bootstrap process in the Daytona sandbox. Added specific OpenRouter authentication patterns (ANTHROPIC_API_KEY="" and ANTHROPIC_AUTH_TOKEN) and optimized the CLI flags (--bare).

### Rationale
The agent was previously failing to initialize or hanging during the bootstrap phase because of authentication conflicts between its internal SDK settings and the OpenRouter overrides. Additionally, excessive conversational noise was avoided by using --bare mode, which helps stay within token limits.

### Plan
1.  Initialize a dedicated package.json in /home/daytona/.claude to isolate the CLI environment.
2.  Set ANTHROPIC_API_KEY: "" to prevent SDK credential discovery conflicts when using OpenRouter.
3.  Use --bare to skip unnecessary discovery steps in scripted runs, reducing startup time and token usage.
4.  Implement AbortController timeouts for worker status webhooks to prevent hanging if the endpoint is unresponsive.

## Infrastructure Monetization and Credit Realignment (2026-04-01)

### Decision
Implemented a two-tier monetization model to account for Daytona infrastructure costs. Added a **100-credit Sandbox Activation Fee** and a **25-credit Infrastructure Overhead** per AI turn.

### Rationale
Previously, billing only covered AI tokens, whereas the application incurred a $0.1656/hour cost for the Daytona sandboxes. This hybrid fee structure ensures the platform's sustainability by recouping infrastructure "rent" based on both session startup and ongoing activity.

### Plan
1. Deduct 100 credits in `generate-daytona` whenever a work session is initialized or resumed.
2. Increment the credit deduction in the `daytona-progress` webhook by 25 credits for every AI-billed message.
3. Update the minimum credit check from 50 to 150 to ensure a user can cover the activation fee + buffer for the first turn.
4. Implemented in a separate worktree (`monetization-refactor`) and branch (`feat/monetization`).
