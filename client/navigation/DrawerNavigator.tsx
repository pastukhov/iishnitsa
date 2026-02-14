import React from "react";
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from "@react-navigation/drawer";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  View,
  StyleSheet,
  Pressable,
  FlatList,
  Image,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import ChatScreen from "@/screens/ChatScreen";
import { useChatStore } from "@/lib/store";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useTranslations } from "@/lib/translations";
import Toast from "react-native-toast-message";
import { LinearGradient } from "expo-linear-gradient";

export type DrawerParamList = {
  Chat: { chatId?: string };
};

const Drawer = createDrawerNavigator<DrawerParamList>();

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useTranslations();
  const {
    chats,
    currentChatId,
    createNewChat,
    selectChat,
    deleteChat,
    restoreChat,
  } = useChatStore();
  const rootNavigation =
    props.navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();

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

  const handleDeleteChat = (chatId: string, _title: string) => {
    const chatToDelete = chats.find((c) => c.id === chatId);
    if (!chatToDelete) return;
    deleteChat(chatId);
    Toast.show({
      type: "info",
      text1: t.chatDeleted,
      text2: t.tapToUndo,
      visibilityTime: 5000,
      onPress: () => {
        restoreChat(chatToDelete);
        Toast.hide();
      },
    });
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
      return t.yesterday;
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
          <View
            style={[styles.avatarContainer, { backgroundColor: theme.surface }]}
          >
            <Image
              source={require("../../assets/images/android-icon-foreground.png")}
              style={styles.avatarImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.profileInfo}>
            <ThemedText style={styles.appName}>{t.appName}</ThemedText>
            <ThemedText
              style={[styles.subtitle, { color: theme.textSecondary }]}
            >
              {t.appSubtitle}
            </ThemedText>
          </View>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.newChatButton,
          { backgroundColor: theme.primary },
          Platform.OS === "ios" && pressed && { opacity: 0.8 },
        ]}
        onPress={handleNewChat}
        accessibilityRole="button"
        accessibilityLabel={t.newChat}
        android_ripple={{ color: theme.primaryContainer, borderless: false }}
      >
        <MaterialIcons name="add" size={20} color={theme.buttonText} />
        <ThemedText style={[styles.newChatText, { color: theme.buttonText }]}>
          {t.newChat}
        </ThemedText>
      </Pressable>

      <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        {t.recentChats}
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
                    : Platform.OS === "ios" && pressed
                      ? theme.surfaceVariant
                      : "transparent",
              },
            ]}
            onPress={() => handleSelectChat(item.id)}
            onLongPress={() => handleDeleteChat(item.id, item.title)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityHint="Long press to delete"
            android_ripple={{ color: theme.surfaceVariant, borderless: false }}
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
            <LinearGradient
              colors={[theme.primaryContainer, theme.surfaceVariant]}
              style={styles.emptyGradientIcon}
            >
              <MaterialIcons
                name="chat-bubble-outline"
                size={32}
                color={theme.primary}
              />
            </LinearGradient>
            <ThemedText
              style={[styles.emptyText, { color: theme.textSecondary }]}
            >
              {t.noChatsYet}
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
            Platform.OS === "ios" && pressed && { opacity: 0.6 },
          ]}
          onPress={() => rootNavigation?.navigate("About")}
          accessibilityRole="button"
          accessibilityLabel={t.about}
          android_ripple={{ color: theme.surfaceVariant, borderless: false }}
        >
          <MaterialIcons
            name="info-outline"
            size={24}
            color={theme.textSecondary}
          />
          <ThemedText
            style={[styles.footerText, { color: theme.textSecondary }]}
          >
            {t.about}
          </ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.footerItem,
            Platform.OS === "ios" && pressed && { opacity: 0.6 },
          ]}
          onPress={() => rootNavigation?.navigate("Settings")}
          accessibilityRole="button"
          accessibilityLabel={t.settings}
          android_ripple={{ color: theme.surfaceVariant, borderless: false }}
        >
          <MaterialIcons
            name="settings"
            size={24}
            color={theme.textSecondary}
          />
          <ThemedText
            style={[styles.footerText, { color: theme.textSecondary }]}
          >
            {t.settings}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

export default function DrawerNavigator() {
  const { theme } = useTheme();

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
        overlayColor: theme.modalOverlay,
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
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImage: {
    width: 48,
    height: 48,
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
  emptyGradientIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
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
