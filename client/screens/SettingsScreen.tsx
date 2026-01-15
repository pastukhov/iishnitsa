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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useChatStore } from "@/lib/store";
import { testConnection, testMCPServer } from "@/lib/api";
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
  keyboardType?: "default" | "url";
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
    addMCPCollection,
    updateMCPCollection,
    deleteMCPCollection,
    setActiveMCPCollection,
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
  const [newCollectionName, setNewCollectionName] = useState("");
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(
    null,
  );
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<{
    loading: boolean;
    message?: string;
    error?: string;
  } | null>(null);
  const systemPromptHeight = useMemo(
    () => Math.max(120, Math.floor(Dimensions.get("window").height / 3)),
    [],
  );
  const uiLabels = {
    testing: "Проверка...",
    test: "Проверить соединение",
    modelsLoading: "Загрузка моделей...",
    connected: (count: number) =>
      `Соединение установлено. Доступно моделей: ${count}.`,
  };

  const providers = getProviders();
  const providerConfig = getProviderConfig(settings.endpoint.providerId);
  const isCustomProvider = settings.endpoint.providerId === "custom";
  const resolvedBaseUrl = isCustomProvider
    ? settings.endpoint.baseUrl
    : providerConfig.baseUrl;
  const modelSelectOptions =
    modelOptions.length > 0
      ? modelOptions.includes(settings.endpoint.model)
        ? modelOptions
        : [...modelOptions, settings.endpoint.model].filter(Boolean)
      : [];

  useEffect(() => {
    setModelOptions([]);
    setModelStatus(null);
  }, [settings.endpoint.apiKey, settings.endpoint.providerId, resolvedBaseUrl]);

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
        : "Ошибка подключения.");
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

  const handleAddCollection = () => {
    const trimmed = newCollectionName.trim();
    if (!trimmed) return;
    addMCPCollection(trimmed, settings.mcpServers);
    setNewCollectionName("");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleStartRenameCollection = (id: string, currentName: string) => {
    setEditingCollectionId(id);
    setEditingCollectionName(currentName);
  };

  const handleSaveCollectionName = () => {
    if (!editingCollectionId) return;
    const trimmed = editingCollectionName.trim();
    if (!trimmed) return;
    updateMCPCollection(editingCollectionId, { name: trimmed });
    setEditingCollectionId(null);
    setEditingCollectionName("");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleDeleteCollection = (id: string, name: string) => {
    Alert.alert(
      "Delete MCP Collection",
      `Are you sure you want to delete "${name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteMCPCollection(id);
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

  const handleSetActiveCollection = (id: string) => {
    setActiveMCPCollection(id);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleProviderChange = (providerId: ProviderId) => {
    const provider = getProviderConfig(providerId);
    updateEndpoint({
      providerId,
      baseUrl: providerId === "custom" ? "" : provider.baseUrl,
    });
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

            {modelSelectOptions.length > 0 ? (
              <SelectField
                label="Model"
                value={settings.endpoint.model}
                options={modelSelectOptions.map((model) => ({
                  label: model,
                  value: model,
                }))}
                onSelect={(value) => updateEndpoint({ model: value })}
                placeholder="Select a model"
              />
            ) : (
              <InputField
                label="Model"
                value={settings.endpoint.model}
                onChangeText={(text) => updateEndpoint({ model: text })}
                placeholder="gpt-4o-mini"
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

            <InputField
              label="System Prompt"
              value={settings.endpoint.systemPrompt}
              onChangeText={(text) => updateEndpoint({ systemPrompt: text })}
              placeholder="You are a helpful AI assistant."
              multiline
              scrollEnabled
              inputStyle={{ height: systemPromptHeight }}
            />

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

                <View style={styles.collectionPanel}>
                  <ThemedText style={styles.collectionTitle}>
                    MCP Collections
                  </ThemedText>
                  {settings.mcpCollections.length > 0 ? (
                    <SelectField
                      label="Active collection"
                      value={settings.activeMcpCollectionId || ""}
                      options={settings.mcpCollections.map((collection) => ({
                        label: `${collection.name} (${collection.servers.length})`,
                        value: collection.id,
                      }))}
                      onSelect={(value) => handleSetActiveCollection(value)}
                      placeholder="Select a collection"
                    />
                  ) : (
                    <ThemedText
                      style={[
                        styles.helperText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      No collections yet. Create one from your current servers.
                    </ThemedText>
                  )}

                  <InputField
                    label="New collection name"
                    value={newCollectionName}
                    onChangeText={setNewCollectionName}
                    placeholder="My MCP setup"
                  />
                  <Pressable
                    onPress={handleAddCollection}
                    disabled={!newCollectionName.trim()}
                    style={({ pressed }) => [
                      styles.addCollectionButton,
                      {
                        backgroundColor: newCollectionName.trim()
                          ? theme.primary
                          : theme.surfaceVariant,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <ThemedText style={{ color: theme.buttonText }}>
                      Create from current
                    </ThemedText>
                  </Pressable>

                  {settings.mcpCollections.map((collection) => (
                    <View key={collection.id} style={styles.collectionItem}>
                      <View style={styles.collectionRow}>
                        <View style={styles.collectionInfo}>
                          <ThemedText style={styles.collectionName}>
                            {collection.name}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.collectionMeta,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {collection.servers.length} server
                            {collection.servers.length === 1 ? "" : "s"}
                          </ThemedText>
                        </View>
                        <View style={styles.collectionButtons}>
                          <Pressable
                            onPress={() =>
                              handleSetActiveCollection(collection.id)
                            }
                            disabled={
                              settings.activeMcpCollectionId === collection.id
                            }
                            style={({ pressed }) => [
                              styles.collectionButton,
                              { opacity: pressed ? 0.6 : 1 },
                            ]}
                          >
                            <MaterialIcons
                              name={
                                settings.activeMcpCollectionId === collection.id
                                  ? "check-circle"
                                  : "check-circle-outline"
                              }
                              size={20}
                              color={theme.primary}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              handleStartRenameCollection(
                                collection.id,
                                collection.name,
                              )
                            }
                            style={({ pressed }) => [
                              styles.collectionButton,
                              { opacity: pressed ? 0.6 : 1 },
                            ]}
                          >
                            <MaterialIcons
                              name="edit"
                              size={20}
                              color={theme.textSecondary}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              handleDeleteCollection(
                                collection.id,
                                collection.name,
                              )
                            }
                            style={({ pressed }) => [
                              styles.collectionButton,
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
                      </View>

                      {editingCollectionId === collection.id && (
                        <View style={styles.collectionEdit}>
                          <InputField
                            label="Rename collection"
                            value={editingCollectionName}
                            onChangeText={setEditingCollectionName}
                            placeholder={collection.name}
                          />
                          <View style={styles.collectionEditActions}>
                            <Pressable
                              onPress={() => {
                                setEditingCollectionId(null);
                                setEditingCollectionName("");
                              }}
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
                              onPress={handleSaveCollectionName}
                              disabled={!editingCollectionName.trim()}
                              style={({ pressed }) => [
                                styles.addButton,
                                {
                                  backgroundColor: editingCollectionName.trim()
                                    ? theme.primary
                                    : theme.surfaceVariant,
                                  opacity: pressed ? 0.8 : 1,
                                },
                              ]}
                            >
                              <ThemedText style={{ color: theme.buttonText }}>
                                Save
                              </ThemedText>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  ))}
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
        </ScrollView>
      </ThemedView>
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
  collectionPanel: {
    gap: Spacing.md,
  },
  collectionTitle: {
    ...Typography.labelLarge,
  },
  collectionItem: {
    marginTop: Spacing.sm,
  },
  collectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  collectionInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  collectionName: {
    ...Typography.bodyLarge,
  },
  collectionMeta: {
    ...Typography.bodySmall,
  },
  collectionButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  collectionButton: {
    padding: Spacing.sm,
  },
  collectionEdit: {
    marginTop: Spacing.sm,
  },
  collectionEditActions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  addCollectionButton: {
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
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
});
