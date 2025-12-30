# AI Agent - Mobile Chat App

## Overview
AI Agent is a mobile application for Android (and iOS/Web) that allows users to chat with AI models through any OpenAI-compatible API endpoint. The app supports Model Context Protocol (MCP) for enhanced AI capabilities.

## Features
- **Custom Endpoint Support**: Connect to any OpenAI-compatible API (OpenAI, Anthropic, local LLMs, etc.)
- **MCP Support**: Configure Model Context Protocol servers for extended AI capabilities
- **Chat History**: Manage multiple chat conversations with drawer navigation
- **Streaming Responses**: Real-time streaming of AI responses
- **Material Design 3**: Modern Android-style UI with light/dark theme support

## Tech Stack
- **Frontend**: Expo/React Native with TypeScript
- **State Management**: Zustand with AsyncStorage persistence
- **Navigation**: React Navigation (Drawer + Stack)
- **Styling**: Material Design 3 color system

## Project Structure
```
client/
├── App.tsx                 # Main app entry point
├── components/             # Reusable UI components
│   ├── ErrorBoundary.tsx   # Error boundary wrapper
│   ├── ErrorFallback.tsx   # Error screen UI
│   ├── ThemedText.tsx      # Themed text component
│   └── ThemedView.tsx      # Themed view component
├── constants/
│   └── theme.ts            # Material Design 3 colors, typography, spacing
├── hooks/
│   ├── useTheme.ts         # Theme hook
│   └── useScreenOptions.ts # Navigation options hook
├── lib/
│   ├── store.ts            # Zustand store with chat/settings state
│   ├── api.ts              # OpenAI API client with streaming
│   └── query-client.ts     # React Query client
├── navigation/
│   ├── RootStackNavigator.tsx  # Root stack navigator
│   └── DrawerNavigator.tsx     # Drawer with chat history
└── screens/
    ├── ChatScreen.tsx      # Main chat interface
    └── SettingsScreen.tsx  # Endpoint and MCP configuration
server/
├── index.ts                # Express server entry
└── routes.ts               # API routes
```

## Configuration

### API Endpoint
Users configure their OpenAI-compatible endpoint in Settings:
- **Base URL**: API endpoint URL (e.g., https://api.openai.com/v1)
- **API Key**: Authentication key
- **Model**: Model name (e.g., gpt-4o-mini)
- **System Prompt**: Custom system prompt for the AI

### MCP Servers
Users can add MCP servers for enhanced capabilities:
- Enable/disable MCP support globally
- Add multiple MCP servers with name and URL
- Toggle individual servers on/off

## Running the App
```bash
npm run server:dev   # Start Express backend
npm run expo:dev     # Start Expo development server
```

## User Preferences
- Theme follows system preference (light/dark)
- All data stored locally using AsyncStorage
- Long-press messages to copy to clipboard
- Long-press chat items in drawer to delete

## Recent Changes
- 2024-12-30: Initial MVP with chat, settings, and MCP support
