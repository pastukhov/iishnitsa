import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
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
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "url";
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
          { backgroundColor: theme.inputBackground, borderColor: theme.outlineVariant },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { color: theme.text },
            multiline && styles.multilineInput,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={secureTextEntry && !showPassword}
          multiline={multiline}
          keyboardType={keyboardType}
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
          <ThemedText style={[styles.toggleDescription, { color: theme.textSecondary }]}>
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
    removeMCPServer,
    toggleMCPServer,
  } = useChatStore();

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [newMCPName, setNewMCPName] = useState("");
  const [newMCPUrl, setNewMCPUrl] = useState("");
  const [showAddMCP, setShowAddMCP] = useState(false);
  const [testingMCPId, setTestingMCPId] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<{
    serverId: string;
    success: boolean;
    message: string;
  } | null>(null);

  const handleTestConnection = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setIsTesting(true);
    setTestResult(null);

    const result = await testConnection(settings.endpoint);
    setTestResult(result);
    setIsTesting(false);

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        result.success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error
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
    });

    setNewMCPName("");
    setNewMCPUrl("");
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
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
          },
        },
      ]
    );
  };

  const handleTestMCPServer = async (server: typeof settings.mcpServers[0]) => {
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
          : Haptics.NotificationFeedbackType.Error
      );
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Endpoint Configuration" />
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <InputField
            label="Base URL"
            value={settings.endpoint.baseUrl}
            onChangeText={(text) => updateEndpoint({ baseUrl: text })}
            placeholder="https://api.openai.com/v1"
            keyboardType="url"
          />

          <InputField
            label="API Key"
            value={settings.endpoint.apiKey}
            onChangeText={(text) => updateEndpoint({ apiKey: text })}
            placeholder="sk-..."
            secureTextEntry
          />

          <InputField
            label="Model"
            value={settings.endpoint.model}
            onChangeText={(text) => updateEndpoint({ model: text })}
            placeholder="gpt-4o-mini"
          />

          <InputField
            label="System Prompt"
            value={settings.endpoint.systemPrompt}
            onChangeText={(text) => updateEndpoint({ systemPrompt: text })}
            placeholder="You are a helpful AI assistant."
            multiline
          />

          <Pressable
            onPress={handleTestConnection}
            disabled={isTesting || !settings.endpoint.apiKey}
            style={({ pressed }) => [
              styles.testButton,
              {
                backgroundColor:
                  settings.endpoint.apiKey ? theme.primary : theme.surfaceVariant,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {isTesting ? (
              <ActivityIndicator size="small" color={theme.buttonText} />
            ) : (
              <>
                <MaterialIcons name="wifi" size={20} color={theme.buttonText} />
                <ThemedText style={[styles.testButtonText, { color: theme.buttonText }]}>
                  Test Connection
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
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <ToggleRow
            label="Enable MCP"
            description="Connect to Model Context Protocol servers for enhanced capabilities"
            value={settings.mcpEnabled}
            onValueChange={(value) => updateSettings({ mcpEnabled: value })}
          />

          {settings.mcpEnabled && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

              {settings.mcpServers.map((server) => (
                <View key={server.id}>
                  <View style={styles.mcpServerRow}>
                    <Pressable
                      onPress={() => toggleMCPServer(server.id)}
                      style={styles.mcpServerInfo}
                    >
                      <MaterialIcons
                        name={server.enabled ? "check-box" : "check-box-outline-blank"}
                        size={24}
                        color={server.enabled ? theme.primary : theme.textSecondary}
                      />
                      <View style={styles.mcpServerText}>
                        <ThemedText style={styles.mcpServerName}>{server.name}</ThemedText>
                        <ThemedText
                          style={[styles.mcpServerUrl, { color: theme.textSecondary }]}
                          numberOfLines={1}
                        >
                          {server.url}
                        </ThemedText>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => handleTestMCPServer(server)}
                      disabled={testingMCPId === server.id}
                      style={({ pressed }) => [styles.testMcpButton, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      {testingMCPId === server.id ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <MaterialIcons name="wifi" size={18} color={theme.primary} />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveMCPServer(server.id, server.name)}
                      style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <MaterialIcons name="delete-outline" size={20} color={theme.error} />
                    </Pressable>
                  </View>
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
                        name={mcpTestResult.success ? "check-circle" : "error"}
                        size={16}
                        color={mcpTestResult.success ? theme.success : theme.error}
                        style={{ marginTop: 2 }}
                      />
                      <ThemedText
                        style={[
                          styles.mcpTestResultText,
                          { color: mcpTestResult.success ? theme.success : theme.error },
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
                  <View style={styles.addMCPButtons}>
                    <Pressable
                      onPress={() => setShowAddMCP(false)}
                      style={({ pressed }) => [
                        styles.cancelButton,
                        { borderColor: theme.outline, opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      <ThemedText>Cancel</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={handleAddMCPServer}
                      style={({ pressed }) => [
                        styles.addButton,
                        { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      <ThemedText style={{ color: theme.buttonText }}>Add Server</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setShowAddMCP(true)}
                  style={({ pressed }) => [
                    styles.addServerButton,
                    { borderColor: theme.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <MaterialIcons name="add" size={20} color={theme.primary} />
                  <ThemedText style={[styles.addServerText, { color: theme.primary }]}>
                    Add MCP Server
                  </ThemedText>
                </Pressable>
              )}
            </>
          )}
        </View>

        <View style={styles.aboutSection}>
          <ThemedText style={[styles.aboutText, { color: theme.textSecondary }]}>
            AI Agent v1.0.0
          </ThemedText>
          <ThemedText style={[styles.aboutText, { color: theme.textSecondary }]}>
            Connect to any OpenAI-compatible endpoint
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
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
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  eyeButton: {
    padding: Spacing.md,
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
  aboutSection: {
    alignItems: "center",
    marginTop: Spacing["3xl"],
    paddingVertical: Spacing.xl,
  },
  aboutText: {
    ...Typography.bodySmall,
    marginBottom: Spacing.xs,
  },
});
