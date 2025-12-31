# Iishnitsa - Mobile & Web Chat App

## Overview
Iishnitsa is a cross-platform application that allows users to chat with AI models through any OpenAI-compatible API endpoint. The app supports Model Context Protocol (MCP) for enhanced AI capabilities with tool calling.

**Both apps are fully standalone - no backend server required!**

## Platforms
- **Expo Mobile App** - Standalone mobile application (Android, iOS, Web)

## Features
- **Custom Endpoint Support**: Connect to any OpenAI-compatible API (OpenAI, Anthropic, local LLMs, etc.)
- **Full MCP Support**: Configure Model Context Protocol servers with real tool calling
- **Chat History**: Manage multiple chat conversations
- **Streaming Responses**: Real-time streaming of AI responses
- **Dark/Light Theme**: Follows system preference
- **Offline Storage**: All data stored locally on device

---

## Expo Mobile App

### Project Structure
```
client/
├── App.tsx                 # Main app entry point
├── components/             # Reusable UI components
├── lib/
│   ├── store.ts            # Zustand store with AsyncStorage
│   ├── api.ts              # OpenAI API client (direct calls)
│   └── mcp-client.ts       # MCP client (direct HTTP)
├── navigation/             # React Navigation setup
└── screens/                # Screen components
```

### Running Mobile App (Development)
```bash
npx expo start
```

### Building APK
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

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
- 2024-12-31: Removed backend server completely - app fully standalone
- 2024-12-31: Made Expo app fully standalone (no server dependency)
- 2024-12-31: Renamed project to Iishnitsa
- 2024-12-30: Initial MVP with chat, settings, and MCP support
