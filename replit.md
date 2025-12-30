# AI Agent - Desktop & Mobile Chat App

## Overview
AI Agent is a cross-platform application that allows users to chat with AI models through any OpenAI-compatible API endpoint. The app supports Model Context Protocol (MCP) for enhanced AI capabilities with tool calling.

## Platforms
- **Electron Desktop App** - Standalone desktop application (Windows, macOS, Linux)
- **Expo Mobile App** - Mobile application (Android, iOS, Web)

## Features
- **Custom Endpoint Support**: Connect to any OpenAI-compatible API (OpenAI, Anthropic, local LLMs, etc.)
- **Full MCP Support**: Configure Model Context Protocol servers with real tool calling
- **Chat History**: Manage multiple chat conversations
- **Streaming Responses**: Real-time streaming of AI responses
- **Dark/Light Theme**: Follows system preference

---

## Electron Desktop App

### Project Structure
```
electron/
├── main.ts                 # Electron main process
└── preload.ts              # Preload script for IPC
src/
├── main.tsx                # React entry point
├── App.tsx                 # Main app component
├── components/
│   ├── Sidebar.tsx         # Chat list and navigation
│   ├── ChatView.tsx        # Chat interface
│   └── SettingsView.tsx    # Settings panel
├── lib/
│   ├── store.ts            # Zustand store
│   ├── api.ts              # OpenAI API client
│   └── mcp-client.ts       # MCP client (direct HTTP, no CORS)
└── styles/
    ├── global.css          # Global styles
    ├── App.css             # App layout styles
    ├── Sidebar.css         # Sidebar styles
    ├── ChatView.css        # Chat styles
    └── SettingsView.css    # Settings styles
```

### Running Electron App (Development)
```bash
./scripts/electron-dev.sh
```

### Building Electron App
```bash
./scripts/electron-build.sh
```

### Key Benefits
- **No CORS restrictions** - Direct HTTP calls to MCP servers
- **No server required** - All logic runs in the app
- **Native performance** - Electron with React
- **Persistent storage** - Uses electron-store

---

## Expo Mobile App

### Project Structure
```
client/
├── App.tsx                 # Main app entry point
├── components/             # Reusable UI components
├── lib/
│   ├── store.ts            # Zustand store
│   ├── api.ts              # OpenAI API client
│   └── mcp-client.ts       # MCP client with proxy support
├── navigation/             # React Navigation setup
└── screens/                # Screen components
server/
├── index.ts                # Express server entry
├── routes.ts               # API routes & MCP proxy
```

### Running Mobile App
```bash
npm run server:dev   # Start Express backend
npm run expo:dev     # Start Expo development server
```

### MCP Proxy
The mobile app uses `/api/mcp-proxy` on the backend to bypass CORS restrictions for external MCP servers.

---

## Configuration

### API Endpoint
- **Base URL**: API endpoint URL (e.g., https://api.openai.com/v1)
- **API Key**: Authentication key
- **Model**: Model name (e.g., gpt-4o-mini)
- **System Prompt**: Custom system prompt for the AI

### MCP Servers
- Enable/disable MCP support globally
- Add multiple MCP servers with name and URL
- Toggle individual servers on/off
- Full tool calling with JSON-RPC 2.0 protocol

---

## Recent Changes
- 2024-12-30: Added standalone Electron desktop app
- 2024-12-30: Fixed MCP proxy for external servers
- 2024-12-30: Initial MVP with chat, settings, and MCP support
