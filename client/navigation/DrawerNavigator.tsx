import React from "react";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from "@react-navigation/drawer";
import { View, StyleSheet, Pressable, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import ChatScreen from "@/screens/ChatScreen";
import { useChatStore } from "@/lib/store";

export type DrawerParamList = {
  Chat: { chatId?: string };
};

const Drawer = createDrawerNavigator<DrawerParamList>();

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { chats, currentChatId, createNewChat, selectChat, deleteChat } =
    useChatStore();

  const sortedChats = [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const handleNewChat = () => {
    createNewChat();
    props.navigation.closeDrawer();
  };

  const handleSelectChat = (chatId: string) => {
    selectChat(chatId);
    props.navigation.closeDrawer();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
            <MaterialIcons
              name="smart-toy"
              size={24}
              color={theme.buttonText}
            />
          </View>
          <View style={styles.profileInfo}>
            <ThemedText style={styles.appName}>AI Agent</ThemedText>
            <ThemedText
              style={[styles.subtitle, { color: theme.textSecondary }]}
            >
              Chat with AI
            </ThemedText>
          </View>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.newChatButton,
          { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 },
        ]}
        onPress={handleNewChat}
      >
        <MaterialIcons name="add" size={20} color={theme.buttonText} />
        <ThemedText style={[styles.newChatText, { color: theme.buttonText }]}>
          New Chat
        </ThemedText>
      </Pressable>

      <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Recent Chats
      </ThemedText>

      <FlatList
        data={sortedChats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.chatItem,
              {
                backgroundColor:
                  item.id === currentChatId
                    ? theme.primaryContainer
                    : pressed
                      ? theme.surfaceVariant
                      : "transparent",
              },
            ]}
            onPress={() => handleSelectChat(item.id)}
            onLongPress={() => deleteChat(item.id)}
          >
            <View style={styles.chatItemContent}>
              <MaterialIcons
                name="chat-bubble-outline"
                size={20}
                color={
                  item.id === currentChatId
                    ? theme.primary
                    : theme.textSecondary
                }
              />
              <View style={styles.chatItemText}>
                <ThemedText
                  style={[
                    styles.chatTitle,
                    item.id === currentChatId && { color: theme.primary },
                  ]}
                  numberOfLines={1}
                >
                  {item.title}
                </ThemedText>
                <ThemedText
                  style={[styles.chatDate, { color: theme.textSecondary }]}
                >
                  {formatDate(item.updatedAt)}
                </ThemedText>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ThemedText
              style={[styles.emptyText, { color: theme.textSecondary }]}
            >
              No chats yet
            </ThemedText>
          </View>
        }
      />

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.footerItem,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          onPress={() => props.navigation.navigate("Settings")}
        >
          <MaterialIcons
            name="settings"
            size={24}
            color={theme.textSecondary}
          />
          <ThemedText
            style={[styles.footerText, { color: theme.textSecondary }]}
          >
            Settings
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

export default function DrawerNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: theme.backgroundRoot,
          width: 300,
        },
        drawerType: "front",
        overlayColor: isDark ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.5)",
      }}
    >
      <Drawer.Screen name="Chat" component={ChatScreen} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  profileInfo: {
    marginLeft: Spacing.md,
  },
  appName: {
    ...Typography.titleLarge,
    fontWeight: "600",
  },
  subtitle: {
    ...Typography.bodySmall,
  },
  newChatButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  newChatText: {
    ...Typography.labelLarge,
  },
  sectionTitle: {
    ...Typography.labelMedium,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing["2xl"],
    marginBottom: Spacing.sm,
  },
  chatList: {
    paddingHorizontal: Spacing.sm,
  },
  chatItem: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  chatItemContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  chatItemText: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  chatTitle: {
    ...Typography.bodyMedium,
  },
  chatDate: {
    ...Typography.bodySmall,
    marginTop: 2,
  },
  emptyState: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    ...Typography.bodyMedium,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  footerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  footerText: {
    ...Typography.bodyLarge,
    marginLeft: Spacing.md,
  },
});
