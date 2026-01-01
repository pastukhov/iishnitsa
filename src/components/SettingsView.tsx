import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import {
  ProviderId,
  fetchProviderModels,
  formatAuthHeaderLabel,
  getProviderConfig,
  getProviders,
} from "../lib/providers";
import "../styles/SettingsView.css";

export default function SettingsView() {
  const {
    settings,
    updateSettings,
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
  } = useStore();
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<{
    loading: boolean;
    message?: string;
    error?: string;
  }>({ loading: false });
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const uiLabels = {
    testing: "Проверка...",
    test: "Проверить соединение",
    modelsLoading: "Загрузка моделей...",
    connected: (count: number) =>
      `Соединение установлено. Доступно моделей: ${count}.`,
  };

  const providers = getProviders();
  const providerConfig = getProviderConfig(settings.providerId);
  const isCustomProvider = settings.providerId === "custom";
  const resolvedBaseUrl = isCustomProvider
    ? settings.baseUrl
    : providerConfig.baseUrl;

  useEffect(() => {
    setModels([]);
    setModelStatus({ loading: false });
    setTestMessage(null);
  }, [settings.apiKey, settings.providerId, resolvedBaseUrl]);

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

  const handleTestConnection = async () => {
    if (!settings.apiKey || !resolvedBaseUrl || isTesting) return;

    setIsTesting(true);
    setTestMessage(null);
    setModelStatus({ loading: true });
    setModels([]);

    const result = await fetchProviderModels({
      providerId: settings.providerId,
      baseUrl: resolvedBaseUrl,
      apiKey: settings.apiKey,
      currentModel: settings.model,
    });

    setModelStatus({
      loading: false,
      message: result.message,
      error: result.error,
    });

    if (result.error) {
      setTestMessage({ success: false, message: result.error });
    } else {
      setModels(result.models);
      setTestMessage({
        success: true,
        message: result.message || uiLabels.connected(result.models.length),
      });
    }

    setIsTesting(false);
  };

  const handleProviderChange = (providerId: ProviderId) => {
    const provider = getProviderConfig(providerId);
    updateSettings({
      providerId,
      baseUrl: providerId === "custom" ? "" : provider.baseUrl,
    });
  };

  return (
    <div className="settings-container">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-section">
        <h2>API Configuration</h2>

        <div className="form-group">
          <label>Provider</label>
          <select
            value={settings.providerId}
            onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Base URL</label>
          <input
            type="text"
            value={resolvedBaseUrl}
            onChange={(e) => updateSettings({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            disabled={!isCustomProvider}
          />
          {!isCustomProvider && (
            <p className="form-hint">Auto-filled from provider selection.</p>
          )}
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => updateSettings({ apiKey: e.target.value })}
            placeholder="sk-..."
          />
          <p className="form-hint">
            Auth format: {formatAuthHeaderLabel(settings.providerId)}
          </p>
        </div>

        <div className="form-group">
          <button
            className="test-button"
            onClick={handleTestConnection}
            disabled={!settings.apiKey || !resolvedBaseUrl || isTesting}
          >
            {isTesting ? uiLabels.testing : uiLabels.test}
          </button>
          {testMessage && (
            <p
              className={`form-hint ${
                testMessage.success ? "success" : "error"
              }`}
            >
              {testMessage.message}
            </p>
          )}
        </div>

        {models.length > 0 ? (
          <div className="form-group">
            <label>Model</label>
            <select
              value={settings.model || ""}
              onChange={(e) => updateSettings({ model: e.target.value })}
            >
              {!settings.model && (
                <option value="" disabled>
                  Select a model
                </option>
              )}
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              {settings.model && !models.includes(settings.model) && (
                <option value={settings.model}>Custom: {settings.model}</option>
              )}
            </select>
            {modelStatus.message && (
              <p className="form-hint">{modelStatus.message}</p>
            )}
          </div>
        ) : (
          <div className="form-group">
            <label>Model</label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
            {modelStatus.loading && (
              <p className="form-hint">{uiLabels.modelsLoading}</p>
            )}
            {modelStatus.error && (
              <p className="form-hint error">{modelStatus.error}</p>
            )}
          </div>
        )}

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
                          updateMCPServer(server.id, {
                            enabled: e.target.checked,
                          })
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
