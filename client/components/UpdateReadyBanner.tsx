import React, { useEffect, useState } from "react";
import { AppState, View, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import {
  PendingUpdate,
  getPendingUpdate,
  installPendingUpdate,
} from "@/lib/update-checker";

export function UpdateReadyBanner() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const checkPendingUpdate = () => {
      getPendingUpdate()
        .then(setPending)
        .catch(() => {});
    };

    checkPendingUpdate();

    // The background task can finish a download while the app is open but
    // backgrounded; re-check when the user comes back so the banner isn't
    // stuck waiting for the next full app restart.
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        checkPendingUpdate();
      }
    });

    return () => subscription.remove();
  }, []);

  if (!pending || dismissed) return null;

  const handleInstall = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setIsInstalling(true);
    try {
      await installPendingUpdate(pending);
    } catch (error) {
      console.error("Failed to launch update install:", error);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setDismissed(true);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.primaryContainer,
          bottom: insets.bottom + Spacing.md,
          ...Shadows.elevation3,
        },
      ]}
    >
      <MaterialIcons
        name="system-update"
        size={20}
        color={theme.onPrimaryContainer}
      />
      <ThemedText
        style={[styles.text, { color: theme.onPrimaryContainer }]}
        numberOfLines={1}
      >
        Update to {pending.version} ready
      </ThemedText>
      <Pressable
        onPress={handleInstall}
        disabled={isInstalling}
        accessibilityRole="button"
        accessibilityLabel={`Install update ${pending.version}`}
        style={({ pressed }) => [
          styles.installButton,
          { opacity: pressed || isInstalling ? 0.7 : 1 },
        ]}
      >
        <ThemedText style={[styles.installText, { color: theme.primary }]}>
          Install
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={({ pressed }) => [
          styles.dismissButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <MaterialIcons
          name="close"
          size={18}
          color={theme.onPrimaryContainer}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  text: {
    ...Typography.bodyMedium,
    flex: 1,
  },
  installButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  installText: {
    ...Typography.labelLarge,
    fontWeight: "600",
  },
  dismissButton: {
    padding: Spacing.xs,
  },
});
