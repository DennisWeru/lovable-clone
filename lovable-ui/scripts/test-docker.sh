#!/bin/bash
# Docker parity testing script
# This replicates the Daytona sandbox environment exactly for agent validation.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOTENV_FILE="$PROJECT_ROOT/.env"
IMAGE_NAME="lovabee-agent-test"

echo "🚀 Building Docker test image: $IMAGE_NAME..."
docker build -t "$IMAGE_NAME" -f "$PROJECT_ROOT/Dockerfile.test" "$PROJECT_ROOT"

echo "🐝 Running agent in Docker..."

# 1. Load Environment Variables from .env
if [ -f "$DOTENV_FILE" ]; then
    ENV_ARGS=$(grep -v '^#' "$DOTENV_FILE" | grep -v '^$' | xargs -I {} echo "--env {}")
else
    echo "⚠️ .env file not found. Ensure agent runner has access to API keys."
    ENV_ARGS=""
fi

# 2. Run the container
docker run --rm -it \
    $ENV_ARGS \
    --env OPENHANDS_WORKSPACE_BASE="/home/daytona/website-project" \
    --env GENERATION_PROMPT="Generate a modern landing page for a coffee shop in the current directory using Vite and Tailwind." \
    --env GENERATION_MODEL="google/gemini-2.0-flash-001" \
    --env OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
    -v "$PROJECT_ROOT/app/api/generate-daytona/agent_runner.py:/home/daytona/agent_runner.py" \
    -v "$PROJECT_ROOT/local-workspace:/home/daytona/website-project" \
    "$IMAGE_NAME" \
    /bin/bash -c ". /home/daytona/.openhands-venv/bin/activate && python3 /home/daytona/agent_runner.py"

echo "✨ Docker Test Complete!"
