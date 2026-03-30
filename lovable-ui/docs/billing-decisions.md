# Log of Decisions - Billing & Credit Deduction System

## 2026-03-30: Refactoring Billing Logic to Per-Turn Atomic Deduction

### Problem Identified
The user reported that credits were not reducing despite multiple generations. Investigation revealed several critical flaws in the billing implementation:
1. **Late Deduction**: Billing only triggered on 'complete' status. If the agent failed or reached turn limits without a final 'complete' signal, no billing occurred.
2. **Partial Billing**: Only the very last turn of the agent loop was being billed. A 20-turn agent session would only charge for the 20th turn.
3. **OpenRouter Latency**: OpenRouter stats take time to populate. A fixed 2s delay often resulted in `total_cost: 0`, causing the deduction to be skipped.
4. **No Fallback**: If the Cost retrieval failed or returned 0, no credits were deducted even if tokens were used.

### Decisions Made
1. **Move Billing to Every Turn**: The worker now sends `genId` and `usage` for every `claude_message` event.
2. **Generic Billing Webhook**: The webhook now processes any payload with a `genId`.
3. **Idempotency Check**: Since `genId` might be sent multiple times (e.g., once in `claude_message` and once in `complete`), the webhook checks the `project_messages` metadata to see if a specific `genId` has already been marked as `billed: true`.
4. **Retry Loop with Backoff**: The cost fetch from OpenRouter now has 3 attempts with increasing delays (2s, 4s, 8s).
5. **Conservative Token Fallback**: If the cost is still 0 after retries but token counts exist, a fallback estimate of $1 per 1M tokens is applied to ensure the user is billed for active usage.
6. **Increased Turn Limit**: Increased `maxTurns` from 25 to 40 in the generator to allow the agent more iterations to finish complex tasks.

### Files Modified
- [`lovable-ui/app/api/generate-daytona/route.ts`](file:///Users/dennisweru/Desktop/Code/CursorExperiments/Lovaclone/lovable-clone/lovable-ui/app/api/generate-daytona/route.ts)
- [`lovable-ui/app/api/webhooks/daytona-progress/route.ts`](file:///Users/dennisweru/Desktop/Code/CursorExperiments/Lovaclone/lovable-clone/lovable-ui/app/api/webhooks/daytona-progress/route.ts)
