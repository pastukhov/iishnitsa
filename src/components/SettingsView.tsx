import React, { useState } from "react";
import { useStore, MCPServer } from "../lib/store";
import "../styles/SettingsView.css";

export default function SettingsView() {
  const { settings, updateSettings, addMCPServer, updateMCPServer, deleteMCPServer } = useStore();
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");

  const handleAddServer = () => {
    if (!newServerName.trim() || !newServerUrl.trim()) return;
    addMCPServer({
      name: newServerName.trim(),
      url: newServerUrl.trim(),
      enabled: true,
    });
    setNewServerName("");
    setNewServerUrl("");
  };

  const handleDeleteServer = (id: string) => {
    if (confirm("Delete this MCP server?")) {
      deleteMCPServer(id);
    }
  };

  return (
    <div className="settings-container">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-section">
        <h2>API Configuration</h2>

        <div className="form-group">
          <label>Base URL</label>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={(e) => updateSettings({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => updateSettings({ apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </div>

        <div className="form-group">
          <label>Model</label>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => updateSettings({ model: e.target.value })}
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="form-group">
          <label>System Prompt</label>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
            placeholder="You are a helpful assistant..."
            rows={4}
          />
        </div>
      </section>

      <section className="settings-section">
        <div className="section-header">
          <h2>MCP Servers</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.mcpEnabled}
              onChange={(e) => updateSettings({ mcpEnabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {settings.mcpEnabled && (
          <>
            <div className="server-list">
              {settings.mcpServers.map((server) => (
                <div key={server.id} className="server-item">
                  <div className="server-info">
                    <span className="server-name">{server.name}</span>
                    <span className="server-url">{server.url}</span>
                  </div>
                  <div className="server-actions">
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={server.enabled}
                        onChange={(e) =>
                          updateMCPServer(server.id, { enabled: e.target.checked })
                        }
                      />
                      <span className="toggle-slider" />
                    </label>
                    <button
                      className="delete-server-btn"
                      onClick={() => handleDeleteServer(server.id)}
                    >
                      x
                    </button>
                  </div>
                </div>
              ))}

              {settings.mcpServers.length === 0 && (
                <p className="no-servers">No MCP servers configured</p>
              )}
            </div>

            <div className="add-server-form">
              <h3>Add MCP Server</h3>
              <div className="form-row">
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="Server name"
                />
                <input
                  type="text"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  placeholder="Server URL"
                />
                <button
                  onClick={handleAddServer}
                  disabled={!newServerName.trim() || !newServerUrl.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
