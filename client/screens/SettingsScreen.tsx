import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  StyleProp,
  TextStyle,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useChatStore } from "@/lib/store";
import { testConnection, testMCPServer } from "@/lib/api";
import { MemoryEntry, MemoryStore } from "@/lib/agent/memory";
import {
  ProviderId,
  formatAuthHeaderLabel,
  getProviderConfig,
  getProviders,
} from "@/lib/providers";

function SectionHeader({ title }: { title: string }) {
  const { theme } = useTheme();
  return (
    <ThemedText style={[styles.sectionHeader, { color: theme.primary }]}>
      {title}
    </ThemedText>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  multiline = false,
  keyboardType = "default",
  editable = true,
  inputStyle,
  scrollEnabled = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "url" | "numeric" | "decimal-pad";
  editable?: boolean;
  inputStyle?: StyleProp<TextStyle>;
  scrollEnabled?: boolean;
}) {
  const { theme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={styles.inputField}>
      <ThemedText style={[styles.inputLabel, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: theme.inputBackground,
            borderColor: theme.outlineVariant,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { color: theme.text },
            multiline && styles.multilineInput,
            !editable && styles.inputDisabled,
            inputStyle,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={secureTextEntry && !showPassword}
          multiline={multiline}
          keyboardType={keyboardType}
          editable={editable}
          scrollEnabled={scrollEnabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeButton}
          >
            <MaterialIcons
              name={showPassword ? "visibility-off" : "visibility"}
              size={20}
              color={theme.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  onSelect,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  placeholder?: string;
  onSelect: (value: string) => void;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <View style={styles.inputField}>
      <ThemedText style={[styles.inputLabel, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={[
          styles.selectTrigger,
          {
            backgroundColor: theme.inputBackground,
            borderColor: theme.outlineVariant,
          },
        ]}
      >
        <ThemedText style={{ color: theme.text }}>
          {selectedLabel || placeholder || "Select"}
        </ThemedText>
        <MaterialIcons
          name={open ? "expand-less" : "expand-more"}
          size={20}
          color={theme.textSecondary}
        />
      </Pressable>
      {open && (
        <View
          style={[
            styles.selectOptions,
            {
              borderColor: theme.outlineVariant,
              backgroundColor: theme.surfaceVariant,
            },
          ]}
        >
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.selectOption,
                {
                  backgroundColor:
                    option.value === value ? theme.surface : "transparent",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <ThemedText style={{ color: theme.text }}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        {description && (
          <ThemedText
            style={[styles.toggleDescription, { color: theme.textSecondary }]}
          >
            {description}
          </ThemedText>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.surfaceVariant, true: theme.primary }}
        thumbColor={theme.surface}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    settings,
    updateEndpoint,
    updateSettings,
    addMCPServer,
    updateMCPServer,
    removeMCPServer,
    toggleMCPServer,
    exportMCPServersYAML,
    importMCPServersYAML,
  } = useChatStore();

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [newMCPName, setNewMCPName] = useState("");
  const [newMCPUrl, setNewMCPUrl] = useState("");
  const [newMCPToken, setNewMCPToken] = useState("");
  const [showAddMCP, setShowAddMCP] = useState(false);
  const [testingMCPId, setTestingMCPId] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<{
    serverId: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importYaml, setImportYaml] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<{
    loading: boolean;
    message?: string;
    error?: string;
  } | null>(null);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const memoryStore = useMemo(() => new MemoryStore(), []);
  const systemPromptHeight = useMemo(
    () => Math.max(120, Math.floor(Dimensions.get("window").height / 3)),
    [],
  );
  const uiLabels = {
    testing: "Checking...",
    test: "Test Connection",
    modelsLoading: "Loading models...",
    connected: (count: number) => `Connected. Available models: ${count}.`,
  };

  const providers = getProviders();
  const providerConfig = getProviderConfig(settings.endpoint.providerId);
  const isCustomProvider = settings.endpoint.providerId === "custom";
  const resolvedBaseUrl = isCustomProvider
    ? settings.endpoint.baseUrl
    : providerConfig.baseUrl;
  const AUTO_MODEL_VALUE = "__auto__";
  const modelSelectOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [
      { label: "Auto (select by complexity)", value: AUTO_MODEL_VALUE },
    ];
    if (modelOptions.length > 0) {
      const baseModels = modelOptions.includes(settings.endpoint.model)
        ? modelOptions
        : [...modelOptions, settings.endpoint.model].filter(Boolean);
      baseModels.forEach((model) => {
        options.push({ label: model, value: model });
      });
    }
    return options;
  }, [modelOptions, settings.endpoint.model]);

  useEffect(() => {
    setModelOptions([]);
    setModelStatus(null);
    setTestResult(null);
  }, [
    settings.endpoint.apiKey,
    settings.endpoint.providerId,
    resolvedBaseUrl,
    settings.endpoint.folderId,
  ]);

  // Auto-fetch models when endpoint configuration changes
  useEffect(() => {
    if (!settings.endpoint.apiKey || !resolvedBaseUrl) {
      return;
    }

    const fetchModels = async () => {
      setModelStatus({ loading: true });
      const result = await testConnection(settings.endpoint);

      if (result.success && result.models && result.models.length > 0) {
        setModelOptions(result.models);
        setModelStatus({
          loading: false,
          message: `${result.models.length} models available`,
        });
      } else {
        setModelOptions([]);
        setModelStatus({
          loading: false,
          message: result.success ? "Enter model manually" : undefined,
          error: result.success ? undefined : result.message,
        });
      }
    };

    // Debounce to avoid too many requests
    const timeoutId = setTimeout(fetchModels, 500);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.endpoint.apiKey,
    settings.endpoint.providerId,
    resolvedBaseUrl,
    settings.endpoint.folderId,
  ]);

  const handleTestConnection = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setIsTesting(true);
    setTestResult(null);
    setModelOptions([]);
    setModelStatus({ loading: true });

    const result = await testConnection(settings.endpoint);
    const resultMessage =
      result.message ||
      (result.success
        ? uiLabels.connected(result.models?.length || 0)
        : "Connection failed.");
    if (result.success) {
      setModelOptions(result.models || []);
      setModelStatus({
        loading: false,
        message: resultMessage,
        error: undefined,
      });
    } else {
      setModelOptions([]);
      setModelStatus({
        loading: false,
        message: undefined,
        error: resultMessage,
      });
    }
    setTestResult({ ...result, message: resultMessage });
    setIsTesting(false);

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        result.success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }
  };

  const handleAddMCPServer = () => {
    if (!newMCPName.trim() || !newMCPUrl.trim()) {
      Alert.alert("Error", "Please enter both name and URL");
      return;
    }

    addMCPServer({
      name: newMCPName.trim(),
      url: newMCPUrl.trim(),
      enabled: true,
      token: newMCPToken.trim() || undefined,
    });

    setNewMCPName("");
    setNewMCPUrl("");
    setNewMCPToken("");
    setShowAddMCP(false);

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleRemoveMCPServer = (id: string, name: string) => {
    Alert.alert(
      "Remove MCP Server",
      `Are you sure you want to remove "${name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            removeMCPServer(id);
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              );
            }
          },
        },
      ],
    );
  };

  const handleTestMCPServer = async (
    server: (typeof settings.mcpServers)[0],
  ) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setTestingMCPId(server.id);
    setMcpTestResult(null);

    const result = await testMCPServer(server);
    setMcpTestResult({
      serverId: server.id,
      success: result.success,
      message: result.message,
    });
    setTestingMCPId(null);

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        result.success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }
  };

  const handleExport = async () => {
    try {
      const yaml = exportMCPServersYAML();
      await Clipboard.setStringAsync(yaml);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        "Exported",
        "MCP servers copied to clipboard (without tokens)",
      );
    } catch (error) {
      console.warn("Failed to export MCP servers:", error);
      Alert.alert("Error", "Failed to export servers");
    }
  };

  const handleImport = () => {
    setImportYaml("");
    setShowImportModal(true);
  };

  const handleConfirmImport = () => {
    try {
      importMCPServersYAML(importYaml);
      setShowImportModal(false);
      setImportYaml("");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("Imported", "MCP servers imported successfully");
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Invalid YAML format",
      );
    }
  };

  const handleProviderChange = (providerId: ProviderId) => {
    const provider = getProviderConfig(providerId);
    const currentProviderId = settings.endpoint.providerId;

    // Save current key/folderId for the old provider
    const providerKeys = { ...settings.providerKeys };
    const providerFolderIds = { ...settings.providerFolderIds };
    if (settings.endpoint.apiKey) {
      providerKeys[currentProviderId] = settings.endpoint.apiKey;
    }
    if (settings.endpoint.folderId) {
      providerFolderIds[currentProviderId] = settings.endpoint.folderId;
    }

    // Restore saved key/folderId for the new provider
    const savedKey = providerKeys[providerId] ?? "";
    const savedFolderId = providerFolderIds[providerId] ?? "";

    updateSettings({ providerKeys, providerFolderIds });
    updateEndpoint({
      providerId,
      baseUrl: providerId === "custom" ? "" : provider.baseUrl,
      model: "",
      apiKey: savedKey,
      folderId: provider.requiresFolderId ? savedFolderId : undefined,
    });
  };

  const handleMemoryLimitChange = (text: string) => {
    const parsed = Math.floor(Number(text));
    if (Number.isFinite(parsed) && parsed > 0) {
      updateSettings({ memoryLimit: parsed });
    }
  };

  const handleMemoryImportanceChange = (text: string) => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(1, parsed));
    updateSettings({ memoryMinImportance: clamped });
  };

  const handleMemoryTtlChange = (text: string) => {
    const parsed = Math.floor(Number(text));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(1, Math.min(365, parsed));
    updateSettings({ memorySummaryTtlDays: clamped });
  };

  const handleViewMemories = async () => {
    setMemoryLoading(true);
    try {
      const entries = await memoryStore.listMemories();
      setMemoryEntries(entries);
      setShowMemoryModal(true);
    } finally {
      setMemoryLoading(false);
    }
  };

  const handleClearMemories = () => {
    Alert.alert(
      "Clear Memory",
      "This will remove all saved memories from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await memoryStore.clear();
            setMemoryEntries([]);
            setShowMemoryModal(false);
          },
        },
      ],
    );
  };

  const formatMemoryTimestamp = (entry: MemoryEntry) => {
    const date = new Date(entry.createdAt);
    return date.toISOString().slice(0, 10);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={insets.top}
    >
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <SectionHeader title="Appearance" />
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <SelectField
              label="Theme"
              value={settings.theme}
              options={[
                { label: "System", value: "system" },
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
              ]}
              onSelect={(value) =>
                updateSettings({
                  theme: value as "system" | "light" | "dark",
                })
              }
            />
          </View>

          <SectionHeader title="Endpoint Configuration" />
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <SelectField
              label="Provider"
              value={settings.endpoint.providerId}
              options={providers.map((provider) => ({
                label: provider.name,
                value: provider.id,
              }))}
              onSelect={(value) => handleProviderChange(value as ProviderId)}
              placeholder="Select a provider"
            />

            <InputField
              label="Base URL"
              value={resolvedBaseUrl}
              onChangeText={(text) => updateEndpoint({ baseUrl: text })}
              placeholder="https://api.openai.com/v1"
              keyboardType="url"
              editable={isCustomProvider}
            />
            {!isCustomProvider && (
              <ThemedText
                style={[styles.helperText, { color: theme.textSecondary }]}
              >
                Auto-filled from provider selection.
              </ThemedText>
            )}

            <InputField
              label="API Key"
              value={settings.endpoint.apiKey}
              onChangeText={(text) => updateEndpoint({ apiKey: text })}
              placeholder="sk-..."
              secureTextEntry
            />
            <ThemedText
              style={[styles.helperText, { color: theme.textSecondary }]}
            >
              Auth format: {formatAuthHeaderLabel(settings.endpoint.providerId)}
            </ThemedText>

            {providerConfig.requiresFolderId && (
              <>
                <InputField
                  label="Folder ID"
                  value={settings.endpoint.folderId || ""}
                  onChangeText={(text) => updateEndpoint({ folderId: text })}
                  placeholder="b1abc123def456..."
                />
                <ThemedText
                  style={[styles.helperText, { color: theme.textSecondary }]}
                >
                  Yandex Cloud folder ID from the cloud console.
                </ThemedText>
              </>
            )}

            {modelSelectOptions.length > 1 ? (
              <SelectField
                label="Model"
                value={settings.endpoint.model || AUTO_MODEL_VALUE}
                options={modelSelectOptions}
                onSelect={(value) =>
                  updateEndpoint({
                    model: value === AUTO_MODEL_VALUE ? "" : value,
                  })
                }
                placeholder="Select a model"
              />
            ) : (
              <InputField
                label="Model"
                value={settings.endpoint.model}
                onChangeText={(text) => updateEndpoint({ model: text })}
                placeholder="gpt-4o-mini (or leave empty for auto)"
              />
            )}
            {modelStatus?.loading && (
              <ThemedText
                style={[styles.helperText, { color: theme.textSecondary }]}
              >
                {uiLabels.modelsLoading}
              </ThemedText>
            )}
            {modelStatus?.message && (
              <ThemedText
                style={[styles.helperText, { color: theme.textSecondary }]}
              >
                {modelStatus.message}
              </ThemedText>
            )}
            {modelStatus?.error && (
              <ThemedText style={[styles.helperText, { color: theme.error }]}>
                {modelStatus.error}
              </ThemedText>
            )}

            <Pressable
              onPress={handleTestConnection}
              disabled={
                isTesting || !settings.endpoint.apiKey || !resolvedBaseUrl
              }
              style={({ pressed }) => [
                styles.testButton,
                {
                  backgroundColor:
                    settings.endpoint.apiKey && resolvedBaseUrl
                      ? theme.primary
                      : theme.surfaceVariant,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {isTesting ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <>
                  <MaterialIcons
                    name="wifi"
                    size={20}
                    color={theme.buttonText}
                  />
                  <ThemedText
                    style={[styles.testButtonText, { color: theme.buttonText }]}
                  >
                    {uiLabels.test}
                  </ThemedText>
                </>
              )}
            </Pressable>

            {testResult && (
              <View
                style={[
                  styles.testResult,
                  {
                    backgroundColor: testResult.success
                      ? theme.successContainer
                      : theme.errorContainer,
                  },
                ]}
              >
                <MaterialIcons
                  name={testResult.success ? "check-circle" : "error"}
                  size={20}
                  color={testResult.success ? theme.success : theme.error}
                />
                <ThemedText
                  style={[
                    styles.testResultText,
                    { color: testResult.success ? theme.success : theme.error },
                  ]}
                >
                  {testResult.message}
                </ThemedText>
              </View>
            )}
          </View>

          <SectionHeader title="System Prompt" />
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <Pressable
              onPress={() => setShowSystemPrompt(!showSystemPrompt)}
              style={[
                styles.systemPromptButton,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.outlineVariant,
                },
              ]}
            >
              <MaterialIcons name="edit" size={20} color={theme.primary} />
              <ThemedText style={{ color: theme.primary, flex: 1 }}>
                Edit System Prompt
              </ThemedText>
              <MaterialIcons
                name={showSystemPrompt ? "expand-less" : "expand-more"}
                size={20}
                color={theme.textSecondary}
              />
            </Pressable>
            {showSystemPrompt && (
              <View style={{ marginTop: Spacing.md }}>
                <TextInput
                  style={[
                    styles.input,
                    styles.multilineInput,
                    {
                      color: theme.text,
                      backgroundColor: theme.inputBackground,
                      borderColor: theme.outlineVariant,
                      borderWidth: 1,
                      borderRadius: BorderRadius.sm,
                      height: systemPromptHeight,
                    },
                  ]}
                  value={settings.systemPrompt}
                  onChangeText={(text) =>
                    updateSettings({ systemPrompt: text })
                  }
                  placeholder="You are a helpful AI assistant."
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  scrollEnabled
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}
          </View>

          <SectionHeader title="MCP Configuration" />
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <ToggleRow
              label="Enable MCP"
              description="Connect to Model Context Protocol servers for enhanced capabilities"
              value={settings.mcpEnabled}
              onValueChange={(value) => updateSettings({ mcpEnabled: value })}
            />

            {settings.mcpEnabled && (
              <>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.outlineVariant },
                  ]}
                />

                <View style={styles.importExportRow}>
                  <Pressable
                    onPress={handleExport}
                    style={({ pressed }) => [
                      styles.importExportButton,
                      {
                        borderColor: theme.primary,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="file-upload"
                      size={18}
                      color={theme.primary}
                    />
                    <ThemedText style={{ color: theme.primary }}>
                      Export
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleImport}
                    style={({ pressed }) => [
                      styles.importExportButton,
                      {
                        borderColor: theme.primary,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="file-download"
                      size={18}
                      color={theme.primary}
                    />
                    <ThemedText style={{ color: theme.primary }}>
                      Import
                    </ThemedText>
                  </Pressable>
                </View>

                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.outlineVariant },
                  ]}
                />

                {settings.mcpServers.map((server) => (
                  <View key={server.id}>
                    <View style={styles.mcpServerRow}>
                      <Pressable
                        onPress={() => toggleMCPServer(server.id)}
                        style={styles.mcpServerInfo}
                      >
                        <MaterialIcons
                          name={
                            server.enabled
                              ? "check-box"
                              : "check-box-outline-blank"
                          }
                          size={24}
                          color={
                            server.enabled ? theme.primary : theme.textSecondary
                          }
                        />
                        <View style={styles.mcpServerText}>
                          <ThemedText style={styles.mcpServerName}>
                            {server.name}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.mcpServerUrl,
                              { color: theme.textSecondary },
                            ]}
                            numberOfLines={1}
                          >
                            {server.url}
                          </ThemedText>
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => handleTestMCPServer(server)}
                        disabled={testingMCPId === server.id}
                        style={({ pressed }) => [
                          styles.testMcpButton,
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        {testingMCPId === server.id ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.primary}
                          />
                        ) : (
                          <MaterialIcons
                            name="wifi"
                            size={18}
                            color={theme.primary}
                          />
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          handleRemoveMCPServer(server.id, server.name)
                        }
                        style={({ pressed }) => [
                          styles.removeButton,
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <MaterialIcons
                          name="delete-outline"
                          size={20}
                          color={theme.error}
                        />
                      </Pressable>
                    </View>
                    <InputField
                      label="Server URL"
                      value={server.url}
                      onChangeText={(text) =>
                        updateMCPServer(server.id, {
                          url: text,
                        })
                      }
                      placeholder="http://localhost:3000"
                      keyboardType="url"
                    />
                    <InputField
                      label="Auth token (optional)"
                      value={server.token ?? ""}
                      onChangeText={(text) =>
                        updateMCPServer(server.id, {
                          token: text.trim() || undefined,
                        })
                      }
                      placeholder="Enter token"
                      secureTextEntry
                    />
                    {mcpTestResult?.serverId === server.id && (
                      <View
                        style={[
                          styles.mcpTestResult,
                          {
                            backgroundColor: mcpTestResult.success
                              ? theme.successContainer
                              : theme.errorContainer,
                          },
                        ]}
                      >
                        <MaterialIcons
                          name={
                            mcpTestResult.success ? "check-circle" : "error"
                          }
                          size={16}
                          color={
                            mcpTestResult.success ? theme.success : theme.error
                          }
                          style={{ marginTop: 2 }}
                        />
                        <ThemedText
                          style={[
                            styles.mcpTestResultText,
                            {
                              color: mcpTestResult.success
                                ? theme.success
                                : theme.error,
                            },
                          ]}
                          selectable
                        >
                          {mcpTestResult.message}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                ))}

                {showAddMCP ? (
                  <View style={styles.addMCPForm}>
                    <InputField
                      label="Server Name"
                      value={newMCPName}
                      onChangeText={setNewMCPName}
                      placeholder="My MCP Server"
                    />
                    <InputField
                      label="Server URL"
                      value={newMCPUrl}
                      onChangeText={setNewMCPUrl}
                      placeholder="http://localhost:3000"
                      keyboardType="url"
                    />
                    <InputField
                      label="Auth token (optional)"
                      value={newMCPToken}
                      onChangeText={setNewMCPToken}
                      placeholder="Enter token"
                      secureTextEntry
                    />
                    <View style={styles.addMCPButtons}>
                      <Pressable
                        onPress={() => setShowAddMCP(false)}
                        style={({ pressed }) => [
                          styles.cancelButton,
                          {
                            borderColor: theme.outline,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <ThemedText>Cancel</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={handleAddMCPServer}
                        style={({ pressed }) => [
                          styles.addButton,
                          {
                            backgroundColor: theme.primary,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <ThemedText style={{ color: theme.buttonText }}>
                          Add Server
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setShowAddMCP(true)}
                    style={({ pressed }) => [
                      styles.addServerButton,
                      {
                        borderColor: theme.primary,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons name="add" size={20} color={theme.primary} />
                    <ThemedText
                      style={[styles.addServerText, { color: theme.primary }]}
                    >
                      Add MCP Server
                    </ThemedText>
                  </Pressable>
                )}
              </>
            )}
          </View>

          <SectionHeader title="Memory & Context" />
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <ToggleRow
              label="Enable memory"
              description="Store key facts and summaries for future chats"
              value={settings.memoryEnabled}
              onValueChange={(value) =>
                updateSettings({ memoryEnabled: value })
              }
            />

            {settings.memoryEnabled && (
              <>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.outlineVariant },
                  ]}
                />
                <ToggleRow
                  label="Save explicit memories"
                  description={
                    'Store details when you say "remember ..." or "zapomni ..."'
                  }
                  value={settings.memoryAutoSave}
                  onValueChange={(value) =>
                    updateSettings({ memoryAutoSave: value })
                  }
                />
                <ToggleRow
                  label="Auto-summarize chats"
                  description="Create short summaries after replies"
                  value={settings.memoryAutoSummary}
                  onValueChange={(value) =>
                    updateSettings({ memoryAutoSummary: value })
                  }
                />
                <InputField
                  label="Summary TTL (days)"
                  value={String(settings.memorySummaryTtlDays)}
                  onChangeText={handleMemoryTtlChange}
                  placeholder="30"
                  keyboardType="numeric"
                />
                <InputField
                  label="Memory limit"
                  value={String(settings.memoryLimit)}
                  onChangeText={handleMemoryLimitChange}
                  placeholder="8"
                  keyboardType="numeric"
                />
                <InputField
                  label="Minimum importance"
                  value={String(settings.memoryMinImportance)}
                  onChangeText={handleMemoryImportanceChange}
                  placeholder="0.5"
                  keyboardType="decimal-pad"
                />
                <View style={styles.memoryActions}>
                  <Pressable
                    onPress={handleViewMemories}
                    disabled={memoryLoading}
                    style={({ pressed }) => [
                      styles.memoryActionButton,
                      {
                        borderColor: theme.primary,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    {memoryLoading ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <MaterialIcons
                        name="list"
                        size={18}
                        color={theme.primary}
                      />
                    )}
                    <ThemedText style={{ color: theme.primary }}>
                      View memories
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleClearMemories}
                    style={({ pressed }) => [
                      styles.memoryClearButton,
                      {
                        borderColor: theme.error,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="delete-outline"
                      size={18}
                      color={theme.error}
                    />
                    <ThemedText style={{ color: theme.error }}>
                      Clear memory
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </ThemedView>

      <Modal
        visible={showImportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowImportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <ThemedText style={styles.modalTitle}>
              Import MCP Servers
            </ThemedText>
            <ThemedText
              style={[styles.modalDescription, { color: theme.textSecondary }]}
            >
              Paste YAML configuration. This will replace all existing servers.
            </ThemedText>
            <TextInput
              style={[
                styles.importInput,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.outlineVariant,
                  color: theme.text,
                },
              ]}
              value={importYaml}
              onChangeText={setImportYaml}
              placeholder={`servers:\n  - name: My Server\n    url: https://example.com`}
              placeholderTextColor={theme.textSecondary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setShowImportModal(false)}
                style={({ pressed }) => [
                  styles.cancelButton,
                  {
                    borderColor: theme.outline,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleConfirmImport}
                disabled={!importYaml.trim()}
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: importYaml.trim()
                      ? theme.primary
                      : theme.surfaceVariant,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Import
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMemoryModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowMemoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <ThemedText style={styles.modalTitle}>Saved Memories</ThemedText>
            <ScrollView style={styles.memoryList} showsVerticalScrollIndicator>
              {memoryEntries.length === 0 ? (
                <ThemedText
                  style={[
                    styles.modalDescription,
                    { color: theme.textSecondary },
                  ]}
                >
                  No memories saved yet.
                </ThemedText>
              ) : (
                memoryEntries.map((entry) => (
                  <View
                    key={entry.id}
                    style={[
                      styles.memoryItem,
                      { borderColor: theme.outlineVariant },
                    ]}
                  >
                    <View style={styles.memoryItemHeader}>
                      <ThemedText style={styles.memoryType}>
                        {entry.type}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.memoryDate,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {formatMemoryTimestamp(entry)}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.memoryContent}>
                      {entry.content}
                    </ThemedText>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setShowMemoryModal(false)}
                style={({ pressed }) => [
                  styles.cancelButton,
                  {
                    borderColor: theme.outline,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText>Close</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleClearMemories}
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: theme.error,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Clear All
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
  },
  sectionHeader: {
    ...Typography.labelLarge,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  card: {
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
  },
  inputField: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.labelMedium,
    marginBottom: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    ...Typography.bodyLarge,
    padding: Spacing.md,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  eyeButton: {
    padding: Spacing.md,
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    padding: Spacing.md,
  },
  selectOptions: {
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  selectOption: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  helperText: {
    ...Typography.bodySmall,
    marginTop: Spacing.xs,
  },
  systemPromptButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  testButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  testButtonText: {
    ...Typography.labelLarge,
  },
  testResult: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  testResultText: {
    ...Typography.bodyMedium,
    flex: 1,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.lg,
  },
  toggleLabel: {
    ...Typography.bodyLarge,
  },
  toggleDescription: {
    ...Typography.bodySmall,
    marginTop: Spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.md,
  },
  importExportRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  importExportButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  mcpServerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  mcpServerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  mcpServerText: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  mcpServerName: {
    ...Typography.bodyLarge,
  },
  mcpServerUrl: {
    ...Typography.bodySmall,
  },
  removeButton: {
    padding: Spacing.sm,
  },
  testMcpButton: {
    padding: Spacing.sm,
    marginRight: Spacing.xs,
  },
  mcpTestResult: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
    marginLeft: Spacing["3xl"],
    gap: Spacing.xs,
  },
  mcpTestResultText: {
    ...Typography.bodySmall,
    flex: 1,
  },
  addMCPForm: {
    marginTop: Spacing.md,
  },
  addMCPButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  addButton: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  addServerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  addServerText: {
    ...Typography.labelLarge,
  },
  memoryActions: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  memoryActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  memoryClearButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  memoryList: {
    maxHeight: 320,
    marginBottom: Spacing.lg,
  },
  memoryItem: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  memoryItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  memoryType: {
    ...Typography.labelMedium,
    textTransform: "capitalize",
  },
  memoryDate: {
    ...Typography.bodySmall,
  },
  memoryContent: {
    ...Typography.bodyMedium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    maxHeight: "80%",
  },
  modalTitle: {
    ...Typography.titleLarge,
    marginBottom: Spacing.sm,
  },
  modalDescription: {
    ...Typography.bodyMedium,
    marginBottom: Spacing.md,
  },
  importInput: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    padding: Spacing.md,
    minHeight: 150,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    ...Typography.bodyMedium,
  },
  modalButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
});
