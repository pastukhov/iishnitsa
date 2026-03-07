import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import * as Linking from "expo-linking";

import { downloadAndInstallApk } from "@/lib/apk-installer";

import { Button } from "@/components/Button";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { appInfo } from "@/lib/app-info";
import { releaseNotes, releaseTag } from "@/constants/releaseNotes";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useTranslations } from "@/lib/translations";
import { useLatestRelease } from "@/lib/github-releases";

export default function AboutScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useTranslations();
  const displayName = t.appName;
  const latestReleaseQuery = useLatestRelease();

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

  const [isDownloading, setIsDownloading] = useState(false);

  const handleUpdatePress = async (downloadUrl: string) => {
    if (Platform.OS === "android") {
      setIsDownloading(true);
      try {
        await downloadAndInstallApk(downloadUrl);
      } catch {
        await Linking.openURL(downloadUrl);
      } finally {
        setIsDownloading(false);
      }
    } else {
      await Linking.openURL(downloadUrl);
    }
  };

  const versionLabel = appInfo.androidVersionCode
    ? `${appInfo.version} (build ${appInfo.androidVersionCode})`
    : appInfo.version;
  const latestRelease = latestReleaseQuery.data;
  const publishedAtLabel = latestRelease?.publishedAt
    ? new Date(latestRelease.publishedAt).toLocaleDateString()
    : null;

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

        <View
          style={[
            styles.updateCard,
            {
              backgroundColor: theme.surface,
              borderColor: theme.outlineVariant,
            },
          ]}
        >
          <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
            {latestRelease?.isUpdateAvailable
              ? t.updateAvailable
              : t.latestVersion}
          </ThemedText>

          {latestReleaseQuery.isLoading ? (
            <View style={styles.updateStatusRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText
                style={[
                  styles.updateStatusText,
                  { color: theme.textSecondary },
                ]}
              >
                {t.checkingForUpdates}
              </ThemedText>
            </View>
          ) : latestReleaseQuery.error ? (
            <ThemedText style={{ color: theme.textSecondary }}>
              {t.updateCheckFailed}
            </ThemedText>
          ) : latestRelease ? (
            <>
              <ThemedText style={[styles.updateSummary, { color: theme.text }]}>
                {latestRelease.isUpdateAvailable
                  ? t.updateAvailable
                  : t.upToDate}
              </ThemedText>
              <ThemedText
                style={[styles.updateMeta, { color: theme.textSecondary }]}
              >
                {t.currentVersion}: {latestRelease.currentVersion}
              </ThemedText>
              <ThemedText
                style={[styles.updateMeta, { color: theme.textSecondary }]}
              >
                {t.latestVersion}: {latestRelease.latestVersion}
              </ThemedText>
              {publishedAtLabel ? (
                <ThemedText
                  style={[styles.updateMeta, { color: theme.textSecondary }]}
                >
                  {t.publishedOn}: {publishedAtLabel}
                </ThemedText>
              ) : null}
              <View style={styles.updateButtons}>
                {latestRelease.isUpdateAvailable ? (
                  <Button
                    disabled={!latestRelease.downloadUrl || isDownloading}
                    onPress={() => handleUpdatePress(latestRelease.downloadUrl)}
                    style={styles.primaryButton}
                  >
                    {isDownloading ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.buttonText}
                      />
                    ) : (
                      t.updateNow
                    )}
                  </Button>
                ) : null}
                <Button
                  variant={
                    latestRelease.isUpdateAvailable ? "outlined" : "filled"
                  }
                  disabled={!latestRelease.releaseUrl}
                  onPress={() => Linking.openURL(latestRelease.releaseUrl)}
                  style={styles.secondaryButton}
                >
                  {t.viewRelease}
                </Button>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
            {t.releaseNotes}
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
  updateCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
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
  updateStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  updateStatusText: {
    ...Typography.bodyMedium,
  },
  updateSummary: {
    ...Typography.titleMedium,
  },
  updateMeta: {
    ...Typography.bodyMedium,
  },
  updateButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
  },
  secondaryButton: {
    flex: 1,
  },
});
