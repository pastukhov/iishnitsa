import React, { useEffect, useState } from "react";
import { useStore } from "./lib/store";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SettingsView from "./components/SettingsView";
import "./styles/global.css";
import "./styles/App.css";

type View = "chat" | "settings";

export default function App() {
  const { initialized, initialize, chats, createChat } = useStore();
  const [currentView, setCurrentView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (initialized && chats.length === 0) {
      createChat();
    }
  }, [initialized, chats.length, createChat]);

  if (!initialized) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      <main className={`main-content ${sidebarOpen ? "" : "sidebar-closed"}`}>
        {currentView === "chat" ? <ChatView /> : <SettingsView />}
      </main>
    </div>
  );
}
