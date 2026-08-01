import React, { useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Toast from "react-native-toast-message";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { useChatStore } from "@/lib/store";
import {
  SkillFileMatch,
  extractSkillDescription,
  fetchRawFile,
  findSkillFiles,
  hashContent,
  parseSkillReference,
} from "@/lib/skills-marketplace";

interface SkillInstallModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SkillInstallModal({
  visible,
  onClose,
}: SkillInstallModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { addSkill } = useChatStore();

  const [reference, setReference] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<SkillFileMatch[] | null>(null);
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(
    null,
  );

  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const resetSearch = () => {
    setMatches(null);
    setRepo(null);
    setError(null);
  };

  const closePreview = () => {
    setPreviewContent(null);
    setPreviewName(null);
    setPreviewPath(null);
  };

  const handleClose = () => {
    setReference("");
    resetSearch();
    closePreview();
    onClose();
  };

  const loadPreview = async (
    owner: string,
    repoName: string,
    match: SkillFileMatch,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const content = await fetchRawFile(owner, repoName, match.path);
      setPreviewContent(content);
      setPreviewName(match.name);
      setPreviewPath(match.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SKILL.md.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFind = async () => {
    const ref = parseSkillReference(reference);
    if (!ref) {
      setError(
        "Couldn't parse that. Paste a skills.sh/GitHub URL or owner/repo[/skill].",
      );
      return;
    }

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setIsLoading(true);
    setError(null);
    resetSearch();
    try {
      const found = await findSkillFiles(ref.owner, ref.repo, ref.slug);
      if (found.length === 0) {
        setError("No SKILL.md found in that repository.");
        return;
      }
      setRepo({ owner: ref.owner, repo: ref.repo });
      if (found.length === 1) {
        await loadPreview(ref.owner, ref.repo, found[0]);
      } else {
        setMatches(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to look up skill.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstall = () => {
    if (!previewContent || !previewName || !repo || !previewPath) return;
    addSkill({
      name: previewName,
      description: extractSkillDescription(previewContent),
      content: previewContent,
      enabled: false,
      sourceId: `${repo.owner}/${repo.repo}/${previewName}`,
      sourceHash: hashContent(previewContent),
    });
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Toast.show({
      type: "success",
      text1: "Skill installed",
      text2: "Enable it in Settings > Skills to use it.",
      visibilityTime: 4000,
    });
    closePreview();
    handleClose();
  };

  const isPreviewing = !!previewContent;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      accessibilityViewIsModal={true}
    >
      <View style={[styles.overlay, { backgroundColor: theme.modalOverlay }]}>
        <ThemedView
          style={[
            styles.container,
            {
              paddingTop: insets.top + Spacing.md,
              paddingBottom: insets.bottom + Spacing.md,
            },
          ]}
        >
          <View style={styles.header}>
            <ThemedText style={styles.title} numberOfLines={1}>
              {isPreviewing ? previewName : "Install Skill"}
            </ThemedText>
            <Pressable
              onPress={isPreviewing ? closePreview : handleClose}
              accessibilityRole="button"
              accessibilityLabel={isPreviewing ? "Back" : "Close"}
              style={({ pressed }) => [
                styles.closeButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <MaterialIcons
                name={isPreviewing ? "arrow-back" : "close"}
                size={24}
                color={theme.text}
              />
            </Pressable>
          </View>

          {isPreviewing ? (
            <>
              <ThemedText
                style={[styles.warningNote, { color: theme.textSecondary }]}
              >
                Community-submitted content — review before enabling. Installed
                skills start disabled.
              </ThemedText>
              <ScrollView
                style={[
                  styles.contentPreview,
                  {
                    backgroundColor: theme.inputBackground,
                    borderColor: theme.outlineVariant,
                  },
                ]}
              >
                <ThemedText selectable style={styles.contentText}>
                  {previewContent}
                </ThemedText>
              </ScrollView>
              <Pressable
                onPress={handleInstall}
                style={({ pressed }) => [
                  styles.installButton,
                  {
                    backgroundColor: theme.primary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Install
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText
                style={[styles.helperText, { color: theme.textSecondary }]}
              >
                Browse skills on{" "}
                <ThemedText
                  style={{ color: theme.primary }}
                  onPress={() => Linking.openURL("https://skills.sh")}
                >
                  skills.sh
                </ThemedText>
                , then paste its link (or `owner/repo/skill`) below to install.
              </ThemedText>

              <View
                style={[
                  styles.searchContainer,
                  {
                    backgroundColor: theme.inputBackground,
                    ...Shadows.elevation1,
                  },
                ]}
              >
                <TextInput
                  style={[styles.searchInput, { color: theme.text }]}
                  placeholder="https://skills.sh/owner/repo/skill"
                  placeholderTextColor={theme.textSecondary}
                  value={reference}
                  onChangeText={setReference}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Skill reference"
                />
              </View>

              <Pressable
                onPress={handleFind}
                disabled={isLoading || !reference.trim()}
                style={({ pressed }) => [
                  styles.installButton,
                  {
                    backgroundColor:
                      isLoading || !reference.trim()
                        ? theme.surfaceVariant
                        : theme.primary,
                    opacity: pressed ? 0.8 : 1,
                    marginBottom: Spacing.md,
                  },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <ThemedText style={{ color: theme.buttonText }}>
                    Find
                  </ThemedText>
                )}
              </Pressable>

              {error && (
                <ThemedText
                  style={{ color: theme.error, marginBottom: Spacing.md }}
                >
                  {error}
                </ThemedText>
              )}

              {matches && repo && (
                <ScrollView>
                  {matches.map((match) => (
                    <Pressable
                      key={match.path}
                      onPress={() => loadPreview(repo.owner, repo.repo, match)}
                      style={({ pressed }) => [
                        styles.matchItem,
                        {
                          backgroundColor:
                            Platform.OS === "ios" && pressed
                              ? theme.surfaceVariant
                              : theme.surface,
                          borderColor: theme.outlineVariant,
                        },
                      ]}
                    >
                      <ThemedText>{match.name}</ThemedText>
                      <MaterialIcons
                        name="chevron-right"
                        size={20}
                        color={theme.textSecondary}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    flex: 1,
    marginTop: 60,
    borderTopLeftRadius: BorderRadius["2xl"],
    borderTopRightRadius: BorderRadius["2xl"],
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    ...Typography.titleLarge,
    fontWeight: "600",
    flexShrink: 1,
  },
  closeButton: {
    padding: Spacing.sm,
    marginRight: -Spacing.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  helperText: {
    ...Typography.bodyMedium,
    marginBottom: Spacing.lg,
  },
  searchContainer: {
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
    height: Spacing.inputHeight,
    justifyContent: "center",
  },
  searchInput: {
    ...Typography.bodyLarge,
  },
  matchItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  warningNote: {
    ...Typography.bodySmall,
    marginBottom: Spacing.md,
  },
  contentPreview: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  contentText: {
    ...Typography.bodySmall,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  installButton: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
});
