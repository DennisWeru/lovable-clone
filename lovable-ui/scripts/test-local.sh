#!/bin/bash
# Local Agent Testing Script
# This replicates the Daytona sandbox environment locally for rapid iteration.

set -e

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$PROJECT_ROOT/local-workspace"
VENV_DIR="$PROJECT_ROOT/.local-venv"
DOTENV_FILE="$PROJECT_ROOT/.env"

echo "🚀 Starting Local Agent Test..."

# 1. Prepare Workspace
mkdir -p "$WORKSPACE_DIR"
echo "✅ Workspace ready at: $WORKSPACE_DIR"

# 2. Setup Virtual Environment
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Creating virtual environment..."
    uv venv "$VENV_DIR"
else
    echo "✅ Virtual environment found."
fi

# 3. Install Dependencies
echo "📦 Installing OpenHands SDK..."
. "$VENV_DIR/bin/activate"
uv pip install openhands

# 4. Load Environment Variables
if [ -f "$DOTENV_FILE" ]; then
    echo "🔑 Loading environment from $DOTENV_FILE..."
    # Export vars from .env, correctly handling comments and blank lines
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ "$line" =~ ^#.*$ ]] && continue
        [[ -z "$line" ]] && continue
        # Handle inline comments and export
        key_value=$(echo "$line" | sed 's/#.*$//' | xargs)
        if [ -n "$key_value" ]; then
            export "$key_value"
        fi
    done < "$DOTENV_FILE"
else
    echo "⚠️ .env file not found. Ensure OPENROUTER_API_KEY is exported."
fi

# 5. Execute Agent Runner
export OPENHANDS_WORKSPACE_BASE="$WORKSPACE_DIR"
export GENERATION_PROMPT="Generate a modern landing page for a coffee shop in the current directory. Use \`npm create vite@latest . -- --template react --no-interactive\` to start. Ensure you use Tailwind CSS, Lucide React icons, and follow the premium aesthetic rules in CLAUDE.md."
# Default model if not in .env
export GENERATION_MODEL="${GENERATION_MODEL:-google/gemini-2.0-flash-001}"
export PYTHONUNBUFFERED=1

echo "🐝 Running agent_runner.py..."
python3 "$PROJECT_ROOT/app/api/generate-daytona/agent_runner.py"

echo "✨ Local Test Complete!"
echo "📂 Files created in $WORKSPACE_DIR:"
ls -F "$WORKSPACE_DIR"
