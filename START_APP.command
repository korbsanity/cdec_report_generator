#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.13 or newer, then run this file again."
  exit 1
fi
if [ -f dist/server/index.js ]; then
  node windows-server.mjs
else
  if [ ! -d node_modules ]; then npm install; fi
  npm run dev
fi
