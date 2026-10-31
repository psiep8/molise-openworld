#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd /home/peppa/code/molise-openworld
node -v
npx tsc --noEmit
npx vitest run --reporter=dot
