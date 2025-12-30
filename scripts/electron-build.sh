#!/bin/bash
# Build Electron app for distribution

# Build React app
npx vite build --config vite.electron.config.ts

# Compile Electron TypeScript
npx tsc -p tsconfig.electron.json

# Build Electron packages
npx electron-builder --config electron-builder.json
