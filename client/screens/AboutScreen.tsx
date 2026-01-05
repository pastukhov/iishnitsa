import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { appInfo } from "@/lib/app-info";
import { releaseNotes, releaseTag } from "@/constants/releaseNotes";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";

export default function AboutScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const displayName = "AI Agent";

  const markdownStyles = {
    body: {
      ...Typography.bodyLarge,
      color: theme.textSecondary,
      lineHeight: 22,
    },
    heading1: {
      ...Typography.titleLarge,
      color: theme.text,
      marginBottom: Spacing.sm,
    },
    heading2: {
      ...Typography.titleMedium,
      color: theme.text,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    bullet_list: {
      marginTop: Spacing.xs,
      marginBottom: Spacing.md,
    },
  };

  const versionLabel = appInfo.androidVersionCode
    ? `${appInfo.version} (build ${appInfo.androidVersionCode})`
    : appInfo.version;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: theme.surface,
              borderColor: theme.outlineVariant,
            },
          ]}
        >
          <ThemedText style={[styles.appName, { color: theme.text }]}>
            {displayName}
          </ThemedText>
          <ThemedText
            style={[styles.versionText, { color: theme.textSecondary }]}
          >
            {versionLabel}
          </ThemedText>
          <ThemedText style={[styles.releaseTag, { color: theme.primary }]}>
            {releaseTag}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
            Release Notes
          </ThemedText>
          <Markdown style={markdownStyles}>{releaseNotes}</Markdown>
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
  heroCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  appName: {
    ...Typography.titleLarge,
  },
  versionText: {
    ...Typography.bodyLarge,
    marginTop: Spacing.xs,
  },
  releaseTag: {
    ...Typography.labelLarge,
    marginTop: Spacing.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.labelLarge,
  },
});
