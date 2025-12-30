#!/bin/bash
# Start Electron in development mode

# Compile electron TypeScript
npx tsc -p tsconfig.electron.json

# Start Vite dev server and Electron concurrently
npx concurrently \
  "npx vite --config vite.electron.config.ts" \
  "npx wait-on http://localhost:5173 && NODE_ENV=development npx electron electron-dist/main.js"
