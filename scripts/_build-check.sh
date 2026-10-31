#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd /home/peppa/code/molise-openworld
node -v
npx tsc --noEmit
echo "TSC_EXIT=$?"
npx vite build
echo "BUILD_EXIT=$?"
