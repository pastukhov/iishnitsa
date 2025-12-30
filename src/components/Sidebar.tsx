import React from "react";
import { useStore } from "../lib/store";
import "../styles/Sidebar.css";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  currentView: "chat" | "settings";
  onViewChange: (view: "chat" | "settings") => void;
}

export default function Sidebar({ open, onToggle, currentView, onViewChange }: SidebarProps) {
  const { chats, currentChatId, selectChat, createChat, deleteChat } = useStore();

  const handleNewChat = () => {
    createChat();
    onViewChange("chat");
  };

  const handleDeleteChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Delete this chat?")) {
      deleteChat(id);
    }
  };

  return (
    <>
      <div className={`sidebar ${open ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <h1 className="sidebar-title">AI Agent</h1>
          <button className="toggle-btn" onClick={onToggle}>
            {open ? "\u2190" : "\u2192"}
          </button>
        </div>

        <button className="new-chat-btn" onClick={handleNewChat}>
          + New Chat
        </button>

        <div className="chat-list">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-item ${chat.id === currentChatId ? "active" : ""}`}
              onClick={() => {
                selectChat(chat.id);
                onViewChange("chat");
              }}
            >
              <span className="chat-title">{chat.title}</span>
              <button
                className="delete-btn"
                onClick={(e) => handleDeleteChat(e, chat.id)}
              >
                x
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            className={`nav-btn ${currentView === "chat" ? "active" : ""}`}
            onClick={() => onViewChange("chat")}
          >
            Chat
          </button>
          <button
            className={`nav-btn ${currentView === "settings" ? "active" : ""}`}
            onClick={() => onViewChange("settings")}
          >
            Settings
          </button>
        </div>
      </div>
      {!open && (
        <button className="sidebar-open-btn" onClick={onToggle}>
          {"\u2630"}
        </button>
      )}
    </>
  );
}
