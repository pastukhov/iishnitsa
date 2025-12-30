import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, DrawerActions } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useChatStore, Message } from "@/lib/store";
import { sendChatMessage } from "@/lib/api";

function MessageBubble({
  message,
  isUser,
}: {
  message: Message;
  isUser: boolean;
}) {
  const { theme } = useTheme();

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message.content);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <Pressable
      onLongPress={handleCopy}
      style={[
        styles.messageBubble,
        isUser ? styles.userBubble : styles.aiBubble,
        {
          backgroundColor: isUser ? theme.userBubble : theme.aiBubble,
          alignSelf: isUser ? "flex-end" : "flex-start",
        },
      ]}
    >
      {!isUser && (
        <View style={[styles.avatarSmall, { backgroundColor: theme.primary }]}>
          <MaterialIcons name="smart-toy" size={16} color={theme.buttonText} />
        </View>
      )}
      <View style={styles.messageContent}>
        <ThemedText
          style={[
            styles.messageText,
            { color: isUser ? theme.userBubbleText : theme.aiBubbleText },
          ]}
        >
          {message.content}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function TypingIndicator() {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.messageBubble,
        styles.aiBubble,
        { backgroundColor: theme.aiBubble, alignSelf: "flex-start" },
      ]}
    >
      <View style={[styles.avatarSmall, { backgroundColor: theme.primary }]}>
        <MaterialIcons name="smart-toy" size={16} color={theme.buttonText} />
      </View>
      <View style={styles.typingDots}>
        <ActivityIndicator size="small" color={theme.primary} />
      </View>
    </View>
  );
}

function EmptyState() {
  const { theme } = useTheme();

  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.primaryContainer }]}>
        <MaterialIcons name="chat" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Start a conversation</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Send a message to begin chatting with your AI agent
      </ThemedText>
    </View>
  );
}

export default function ChatScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState("");

  const {
    getCurrentChat,
    addMessage,
    updateLastAssistantMessage,
    isStreaming,
    setIsStreaming,
    settings,
    loadFromStorage,
    clearCurrentChat,
  } = useChatStore();

  const currentChat = getCurrentChat();
  const messages = currentChat?.messages || [];

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setInputText("");
    addMessage({ role: "user", content: text });

    if (!settings.endpoint.apiKey) {
      addMessage({
        role: "assistant",
        content: "Please configure your API endpoint in Settings first.",
      });
      return;
    }

    setIsStreaming(true);
    addMessage({ role: "assistant", content: "" });

    try {
      const allMessages = [
        ...messages,
        { id: "temp", role: "user" as const, content: text, timestamp: new Date().toISOString() },
      ];

      await sendChatMessage(
        allMessages,
        settings.endpoint,
        (chunk) => {
          updateLastAssistantMessage(chunk);
        },
        settings.mcpServers,
        settings.mcpEnabled
      );
    } catch (error: any) {
      updateLastAssistantMessage(
        `Error: ${error.message || "Failed to get response from AI"}`
      );
    } finally {
      setIsStreaming(false);
    }
  }, [inputText, isStreaming, messages, settings, addMessage, updateLastAssistantMessage, setIsStreaming]);

  const handleClearChat = () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    clearCurrentChat();
  };

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const openSettings = () => {
    (navigation as any).navigate("Settings");
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + Spacing.sm,
            backgroundColor: theme.backgroundRoot,
            borderBottomColor: theme.outlineVariant,
          },
        ]}
      >
        <Pressable
          onPress={openDrawer}
          style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <MaterialIcons name="menu" size={24} color={theme.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <View style={[styles.statusDot, { backgroundColor: settings.endpoint.apiKey ? theme.success : theme.error }]} />
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {settings.endpoint.model || "AI Agent"}
          </ThemedText>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={handleClearChat}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <MaterialIcons name="delete-outline" size={24} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={openSettings}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <MaterialIcons name="settings" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: Spacing["2xl"] },
          ]}
          renderItem={({ item }) => (
            <MessageBubble message={item} isUser={item.role === "user"} />
          )}
          ListEmptyComponent={EmptyState}
          ListFooterComponent={isStreaming ? <TypingIndicator /> : null}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
        />

        <View
          style={[
            styles.inputContainer,
            {
              paddingBottom: insets.bottom + Spacing.sm,
              backgroundColor: theme.backgroundRoot,
              borderTopColor: theme.outlineVariant,
            },
          ]}
        >
          <View
            style={[
              styles.inputWrapper,
              {
                backgroundColor: theme.inputBackground,
                ...Shadows.elevation2,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Message AI agent..."
              placeholderTextColor={theme.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={4000}
              editable={!isStreaming}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim() || isStreaming}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor:
                    inputText.trim() && !isStreaming ? theme.primary : theme.surfaceVariant,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <MaterialIcons
                name="send"
                size={20}
                color={inputText.trim() && !isStreaming ? theme.buttonText : theme.textSecondary}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    padding: Spacing.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    ...Typography.titleMedium,
    fontWeight: "600",
  },
  headerRight: {
    flexDirection: "row",
  },
  keyboardContainer: {
    flex: 1,
  },
  messageList: {
    padding: Spacing.lg,
    flexGrow: 1,
  },
  messageBubble: {
    flexDirection: "row",
    maxWidth: "85%",
    marginBottom: Spacing.md,
    padding: Spacing.messagePadding,
    borderRadius: BorderRadius.message,
  },
  userBubble: {
    borderBottomRightRadius: Spacing.xs,
  },
  aiBubble: {
    borderBottomLeftRadius: Spacing.xs,
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.sm,
  },
  messageContent: {
    flex: 1,
  },
  messageText: {
    ...Typography.bodyLarge,
  },
  typingDots: {
    paddingVertical: Spacing.xs,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.headlineSmall,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.bodyMedium,
    textAlign: "center",
  },
  inputContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: BorderRadius.xl,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  input: {
    flex: 1,
    ...Typography.bodyLarge,
    maxHeight: 120,
    paddingVertical: Spacing.sm,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: Spacing.sm,
  },
});
