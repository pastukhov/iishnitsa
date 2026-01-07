import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import {
  ProviderId,
  fetchProviderModels,
  formatAuthHeaderLabel,
  getProviderConfig,
  getProviders,
} from "../lib/providers";
import {
  buildMCPCollectionsYaml,
  parseMCPCollectionsYaml,
} from "../lib/mcp-collections";
import "../styles/SettingsView.css";

export default function SettingsView() {
  const {
    settings,
    updateSettings,
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
    addMCPCollection,
    updateMCPCollection,
    deleteMCPCollection,
    setActiveMCPCollection,
    replaceMCPCollections,
  } = useStore();
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerToken, setNewServerToken] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionMessage, setCollectionMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
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
      token: newServerToken.trim() || undefined,
    });
    setNewServerName("");
    setNewServerUrl("");
    setNewServerToken("");
  };

  const handleDeleteServer = (id: string) => {
    if (confirm("Delete this MCP server?")) {
      deleteMCPServer(id);
    }
  };

  const handleAddCollection = () => {
    const trimmed = newCollectionName.trim();
    if (!trimmed) return;
    addMCPCollection(trimmed, settings.mcpServers);
    setNewCollectionName("");
  };

  const handleRenameCollection = (id: string, currentName: string) => {
    const nextName = prompt("New collection name:", currentName);
    if (!nextName) return;
    updateMCPCollection(id, { name: nextName.trim() || currentName });
  };

  const handleDeleteCollection = (id: string, name: string) => {
    if (confirm(`Delete MCP collection "${name}"?`)) {
      deleteMCPCollection(id);
    }
  };

  const handleExportCollections = () => {
    const yaml = buildMCPCollectionsYaml(
      settings.mcpCollections,
      settings.activeMcpCollectionId,
    );
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mcp-collections.yaml";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportCollections = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseMCPCollectionsYaml(text);
      replaceMCPCollections(result.collections, result.activeCollectionId);
      setCollectionMessage(
        result.warnings.length > 0
          ? { tone: "error", text: result.warnings.join(" ") }
          : { tone: "success", text: "Collections imported successfully." },
      );
      event.target.value = "";
    } catch {
      setCollectionMessage({
        tone: "error",
        text: "Failed to import YAML. Please check the file format.",
      });
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
            <div className="collection-panel">
              <div className="collection-header">
                <h3>MCP Collections</h3>
                <div className="collection-actions">
                  <button
                    className="secondary-button"
                    onClick={handleExportCollections}
                    disabled={settings.mcpCollections.length === 0}
                  >
                    Export YAML
                  </button>
                  <label className="secondary-button file-button">
                    Import YAML
                    <input
                      type="file"
                      accept=".yaml,.yml"
                      onChange={handleImportCollections}
                    />
                  </label>
                </div>
              </div>

              <div className="collection-controls">
                <div className="form-group">
                  <label>Active collection</label>
                  <select
                    value={settings.activeMcpCollectionId || ""}
                    onChange={(e) =>
                      setActiveMCPCollection(
                        e.target.value ? e.target.value : null,
                      )
                    }
                  >
                    {settings.mcpCollections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name} ({collection.servers.length})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row collection-row">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="New collection name"
                  />
                  <button
                    onClick={handleAddCollection}
                    disabled={!newCollectionName.trim()}
                  >
                    Create from current
                  </button>
                </div>
              </div>

              {collectionMessage && (
                <p
                  className={`form-hint ${
                    collectionMessage.tone === "error" ? "error" : "success"
                  }`}
                >
                  {collectionMessage.text}
                </p>
              )}

              <div className="collection-list">
                {settings.mcpCollections.map((collection) => (
                  <div key={collection.id} className="collection-item">
                    <div className="collection-info">
                      <span className="collection-name">{collection.name}</span>
                      <span className="collection-meta">
                        {collection.servers.length} server
                        {collection.servers.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="collection-buttons">
                      <button
                        className="secondary-button"
                        onClick={() => setActiveMCPCollection(collection.id)}
                        disabled={
                          settings.activeMcpCollectionId === collection.id
                        }
                      >
                        Use
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          handleRenameCollection(collection.id, collection.name)
                        }
                      >
                        Rename
                      </button>
                      <button
                        className="delete-server-btn"
                        onClick={() =>
                          handleDeleteCollection(collection.id, collection.name)
                        }
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="server-list">
              {settings.mcpServers.map((server) => (
                <div key={server.id} className="server-item">
                  <div className="server-info">
                    <span className="server-name">{server.name}</span>
                    <span className="server-url">{server.url}</span>
                    <input
                      type="password"
                      value={server.token ?? ""}
                      onChange={(e) =>
                        updateMCPServer(server.id, {
                          token: e.target.value.trim() || undefined,
                        })
                      }
                      placeholder="Auth token (optional)"
                    />
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
                <input
                  type="password"
                  value={newServerToken}
                  onChange={(e) => setNewServerToken(e.target.value)}
                  placeholder="Auth token (optional)"
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
