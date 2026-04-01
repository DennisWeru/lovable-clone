---
description: Test Daytona sandbox creation and OpenHands installation locally.
---

1.  **Ensure API Keys are set**: Check your `.env` file for `DAYTONA_API_KEY` and `OPENROUTER_API_KEY`.
2.  **Move to project directory**:
    ```bash
    cd lovable-clone/lovable-ui
    ```
3.  **Ensure dependencies**:
    ```bash
    npm install @daytonaio/sdk dotenv
    ```
4.  **Run the test script**:
    ```bash
    node scripts/test-daytona-openhands.mjs
    ```
5.  **Monitor the logs**: The script will stream progress, including the installation of `uv` and `openhands-ai`.
6.  **Cleanup**: The script will automatically delete the sandbox upon completion or error. If it is interrupted, use `scripts/remove-sandbox.ts` to clean up manually.
