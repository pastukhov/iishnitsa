import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  ScrollView,
  Alert,
  ActionSheetIOS,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, DrawerActions } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import Markdown from "react-native-markdown-display";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { AttachedImage } from "@/components/AttachedImage";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useChatStore, Message, MessageAttachment } from "@/lib/store";
import { sendChatMessage, flushQueuedChatMessages } from "@/lib/api";
import {
  pickImageFromLibrary,
  pickImageFromCamera,
  deleteImage,
} from "@/lib/image-utils";

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

  const markdownStyles = {
    body: {
      color: isUser ? theme.userBubbleText : theme.aiBubbleText,
      fontSize: Typography.body.fontSize,
      lineHeight: 22,
    },
    link: { color: theme.primary },
    paragraph: { marginTop: 0, marginBottom: 8 },
    bullet_list: { marginVertical: 8 },
    ordered_list: { marginVertical: 8 },
    list_item: { marginVertical: 2 },
    code_inline: {
      backgroundColor: theme.surfaceVariant,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
      color: theme.text,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    fence: {
      backgroundColor: theme.surfaceVariant,
      borderRadius: 8,
      padding: 8,
      color: theme.text,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    blockquote: {
      borderLeftColor: theme.outlineVariant,
      borderLeftWidth: 3,
      paddingLeft: 8,
      color: theme.textSecondary,
    },
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
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.attachmentsContainer}>
            {message.attachments.map((attachment) => (
              <AttachedImage
                key={attachment.id}
                attachment={attachment}
                size="bubble"
              />
            ))}
          </View>
        )}
        {message.content ? (
          isUser ? (
            <ThemedText
              style={[
                styles.messageText,
                { color: isUser ? theme.userBubbleText : theme.aiBubbleText },
              ]}
            >
              {message.content}
            </ThemedText>
          ) : (
            <Markdown
              style={markdownStyles}
              onLinkPress={(url) => {
                Linking.openURL(url);
                return true;
              }}
            >
              {message.content}
            </Markdown>
          )
        ) : null}
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
      <View
        style={[styles.emptyIcon, { backgroundColor: theme.primaryContainer }]}
      >
        <MaterialIcons name="chat" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Start a conversation</ThemedText>
      <ThemedText
        style={[styles.emptySubtitle, { color: theme.textSecondary }]}
      >
        Send a message to begin chatting with Iishnitsa
      </ThemedText>
    </View>
  );
}

export default function ChatScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    MessageAttachment[]
  >([]);

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
  const messages = useMemo(
    () => currentChat?.messages || [],
    [currentChat?.messages],
  );

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const flushQueued = async () => {
      if (!currentChat?.id || isStreaming) return;
      await flushQueuedChatMessages({
        chatId: currentChat.id,
        onChunk: (chunk) => {
          updateLastAssistantMessage(chunk);
        },
        onItemStart: () => {
          addMessage({ role: "assistant", content: "" });
          setIsStreaming(true);
        },
        onItemFinish: () => {
          setIsStreaming(false);
        },
      });
    };

    flushQueued();
  }, [
    currentChat?.id,
    isStreaming,
    addMessage,
    updateLastAssistantMessage,
    setIsStreaming,
  ]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || isStreaming) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const attachmentsToSend = [...pendingAttachments];
    setInputText("");
    setPendingAttachments([]);
    addMessage({
      role: "user",
      content: text,
      attachments: hasAttachments ? attachmentsToSend : undefined,
    });

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
        {
          id: "temp",
          role: "user" as const,
          content: text,
          timestamp: new Date().toISOString(),
          attachments: hasAttachments ? attachmentsToSend : undefined,
        },
      ];

      await sendChatMessage(
        allMessages,
        settings.endpoint,
        (chunk) => {
          updateLastAssistantMessage(chunk);
        },
        settings.mcpServers,
        settings.mcpEnabled,
        {
          queueOnFailure: true,
          chatId: currentChat?.id,
          onQueued: () => {
            updateLastAssistantMessage(
              "Queued. Will retry when you're back online.",
            );
          },
        },
      );
    } catch (error: any) {
      updateLastAssistantMessage(
        `Error: ${error.message || "Failed to get response from AI"}`,
      );
    } finally {
      setIsStreaming(false);
    }
  }, [
    inputText,
    pendingAttachments,
    isStreaming,
    messages,
    currentChat?.id,
    settings,
    addMessage,
    updateLastAssistantMessage,
    setIsStreaming,
  ]);

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

  const handleRemoveAttachment = useCallback(
    async (id: string) => {
      const attachment = pendingAttachments.find((a) => a.id === id);
      if (attachment) {
        await deleteImage(attachment.uri);
      }
      setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [pendingAttachments],
  );

  const handlePickImage = useCallback(async (source: "library" | "camera") => {
    try {
      const attachment =
        source === "library"
          ? await pickImageFromLibrary()
          : await pickImageFromCamera();
      if (attachment) {
        setPendingAttachments((prev) => [...prev, attachment]);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to pick image");
    }
  }, []);

  const showAttachOptions = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Photo Library", "Camera"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) handlePickImage("library");
          else if (buttonIndex === 2) handlePickImage("camera");
        },
      );
    } else {
      Alert.alert("Add Image", "Choose image source", [
        { text: "Cancel", style: "cancel" },
        { text: "Photo Library", onPress: () => handlePickImage("library") },
        { text: "Camera", onPress: () => handlePickImage("camera") },
      ]);
    }
  }, [handlePickImage]);

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
          style={({ pressed }) => [
            styles.headerButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <MaterialIcons name="menu" size={24} color={theme.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: settings.endpoint.apiKey
                  ? theme.success
                  : theme.error,
              },
            ]}
          />
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {settings.endpoint.model || "Iishnitsa"}
          </ThemedText>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={handleClearChat}
            style={({ pressed }) => [
              styles.headerButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <MaterialIcons name="delete-outline" size={24} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={openSettings}
            style={({ pressed }) => [
              styles.headerButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <MaterialIcons name="settings" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
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
          {pendingAttachments.length > 0 && (
            <ScrollView
              horizontal
              style={styles.attachmentsPreview}
              showsHorizontalScrollIndicator={false}
            >
              {pendingAttachments.map((attachment) => (
                <AttachedImage
                  key={attachment.id}
                  attachment={attachment}
                  size="preview"
                  onRemove={() => handleRemoveAttachment(attachment.id)}
                />
              ))}
            </ScrollView>
          )}
          <View
            style={[
              styles.inputWrapper,
              {
                backgroundColor: theme.inputBackground,
                ...Shadows.elevation2,
              },
            ]}
          >
            <Pressable
              onPress={showAttachOptions}
              disabled={isStreaming}
              style={({ pressed }) => [
                styles.attachButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <MaterialIcons
                name="add-photo-alternate"
                size={24}
                color={isStreaming ? theme.textSecondary : theme.primary}
              />
            </Pressable>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Message Iishnitsa..."
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
              disabled={
                (!inputText.trim() && pendingAttachments.length === 0) ||
                isStreaming
              }
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor:
                    (inputText.trim() || pendingAttachments.length > 0) &&
                    !isStreaming
                      ? theme.primary
                      : theme.surfaceVariant,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <MaterialIcons
                name="send"
                size={20}
                color={
                  (inputText.trim() || pendingAttachments.length > 0) &&
                  !isStreaming
                    ? theme.buttonText
                    : theme.textSecondary
                }
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
  attachmentsContainer: {
    marginBottom: Spacing.sm,
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
  attachmentsPreview: {
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: BorderRadius.xl,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  attachButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
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
