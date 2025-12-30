# Design Guidelines: AI Agent Chat App (Android)

## Architecture Decisions

### Authentication
**Local-First with Optional Sync**
- No mandatory authentication on first launch
- User can start chatting immediately with their configured endpoint
- **Profile/Settings screen** includes:
  - User avatar selection (generate 3 minimalist geometric avatars)
  - Display name field
  - Optional cloud sync account setup (Google Sign-In)
- If user opts for cloud sync:
  - Include Google Sign-In
  - Privacy policy & terms of service links
  - Account settings with logout and delete account options

### Navigation Architecture
**Drawer Navigation**
- **Drawer contents:**
  - User profile header (avatar, name)
  - "New Chat" action button
  - List of previous chat sessions (timestamped)
  - Settings item
  - About/Help item
- **Main screen:** Active chat conversation
- **Modal screens:** Settings, Endpoint Configuration, MCP Setup

### Core Screens

#### 1. Chat Screen (Main)
**Purpose:** Real-time conversation with AI agent

**Layout:**
- **Header:** 
  - Hamburger menu (left) to open drawer
  - AI agent name/endpoint indicator (center)
  - Options menu (right): Clear chat, Share conversation
  - Transparent background with subtle elevation
- **Main Content:**
  - Scrollable message list (inverted)
  - Message bubbles: User (right-aligned, primary color), AI (left-aligned, surface variant)
  - AI avatar icon for each AI message
  - Typing indicator when AI is responding
- **Input Area (floating):**
  - Text input field with hint "Message AI agent..."
  - Send button (Material 3 filled icon button)
  - Attachment button (optional: for future file support)
  - Safe area: bottom inset + 16dp padding
- **Safe Areas:**
  - Top: statusBarHeight + 16dp
  - Bottom: navigationBarHeight + 16dp

#### 2. Settings Screen (Modal)
**Purpose:** App configuration and endpoint management

**Layout:**
- **Header:** 
  - Back button (left)
  - Title: "Settings"
  - Non-transparent Material 3 top app bar
- **Main Content (Scrollable Form):**
  - **Section: Endpoint Configuration**
    - Base URL input field
    - API Key input (password field, with show/hide toggle)
    - Model selection dropdown
    - Test connection button
  - **Section: MCP Configuration**
    - Enable MCP toggle
    - MCP server URL input
    - Advanced settings (collapsed accordion)
  - **Section: Appearance**
    - Theme selector (Light/Dark/System)
    - Message font size slider
  - **Section: Account** (if signed in)
    - Cloud sync toggle
    - Log out button
    - Delete account (nested under danger zone)
- **Safe Areas:**
  - Top: 16dp
  - Bottom: navigationBarHeight + 16dp

#### 3. Chat History (Drawer)
**Purpose:** Navigate between chat sessions

**Layout:**
- List of chat cards showing:
  - First message preview
  - Timestamp
  - Swipe actions: Delete, Archive
  - Long-press: Rename, Share

## Design System

### Color Palette (Material Design 3)
- **Primary:** Dynamic color based on user's system (Material You)
- **Surface variant:** For AI message bubbles
- **On-surface variant:** For secondary text
- **Error:** For connection failures, API errors
- Use Material 3 color roles for consistency

### Typography (Material Design 3)
- **Display:** For onboarding/empty states
- **Headline Small:** Section headers in settings
- **Body Large:** Chat messages
- **Body Medium:** Timestamps, metadata
- **Label Large:** Buttons, input labels
- Font: Roboto (system default)

### Components

**Message Bubbles:**
- User: Rounded corners (16dp), primary container color, right-aligned
- AI: Rounded corners (16dp), surface variant color, left-aligned
- Max width: 80% of screen width
- Padding: 12dp horizontal, 10dp vertical
- No drop shadows (use subtle elevation)

**Input Field:**
- Material 3 filled text field
- Floating above content with subtle elevation
- shadowOffset: {width: 0, height: 4}
- shadowOpacity: 0.12
- shadowRadius: 8
- elevation: 4

**Buttons:**
- Send button: Filled tonal icon button
- Destructive actions: Outlined button with error color
- Primary actions: Filled button

**Visual Feedback:**
- All touchables use Material 3 ripple effect
- Pressed state: Reduce opacity to 0.8
- Loading states: Circular progress indicators

### Critical Assets
1. **AI Agent Avatar:** Generate 1 minimalist robot icon (geometric, friendly, tech-aesthetic)
2. **User Avatars:** Generate 3 geometric abstract avatars (circles, triangles, gradients) matching Material Design aesthetic
3. **Empty State Illustration:** Simple vector graphic for "Start a conversation"

### Icons
- Use Material Icons (expo-vector-icons: MaterialIcons)
- Menu, send, settings, delete, share, attach

### Accessibility
- Minimum touch target: 48dp × 48dp
- Text contrast ratio: 4.5:1 minimum
- Support TalkBack screen reader
- Scalable text (respect system font size)
- Haptic feedback on important actions (send message, delete chat)