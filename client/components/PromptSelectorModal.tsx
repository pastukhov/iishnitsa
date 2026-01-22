import React, { useState, useMemo } from "react";
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  SectionList,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import {
  SystemPrompt,
  searchPrompts,
  getTopTags,
  getPromptsByTag,
  getPromptsByIds,
} from "@/lib/prompts";
import { getDeviceLanguageCode } from "@/lib/locale";
import { useChatStore } from "@/lib/store";
import { useTranslations } from "@/lib/translations";

interface PromptSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (prompt: SystemPrompt | null) => void;
}

interface SectionData {
  title: string;
  data: SystemPrompt[];
}

export function PromptSelectorModal({
  visible,
  onClose,
  onSelect,
}: PromptSelectorModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useTranslations();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const languageCode = useMemo(() => getDeviceLanguageCode(), []);

  const {
    settings: { favoritePromptIds, recentPromptIds },
    toggleFavoritePrompt,
    addRecentPrompt,
  } = useChatStore();

  const topTags = useMemo(() => getTopTags(10), []);

  const sections = useMemo((): SectionData[] => {
    const results: SectionData[] = [];

    let filtered = searchQuery
      ? searchPrompts(searchQuery, languageCode)
      : selectedTag
        ? getPromptsByTag(selectedTag, languageCode)
        : searchPrompts("", languageCode);

    if (!searchQuery) {
      if (favoritePromptIds.length > 0) {
        const favs = getPromptsByIds(favoritePromptIds, languageCode).filter(
          (p) => filtered.some((f) => f.id === p.id),
        );
        if (favs.length > 0) {
          results.push({ title: `⭐ ${t.favoritePrompts}`, data: favs });
        }
      }

      if (recentPromptIds.length > 0) {
        const recents = getPromptsByIds(recentPromptIds, languageCode)
          .filter((p) => !favoritePromptIds.includes(p.id))
          .filter((p) => filtered.some((f) => f.id === p.id));
        if (recents.length > 0) {
          results.push({ title: `🕐 ${t.recentPrompts}`, data: recents });
        }
      }
    }

    const remaining = filtered.filter(
      (p) =>
        !favoritePromptIds.includes(p.id) && !recentPromptIds.includes(p.id),
    );
    if (remaining.length > 0) {
      const title = selectedTag
        ? `#${selectedTag}`
        : searchQuery
          ? t.searchResults
          : t.allPrompts;
      results.push({ title, data: remaining });
    }

    return results;
  }, [
    languageCode,
    searchQuery,
    selectedTag,
    favoritePromptIds,
    recentPromptIds,
    t,
  ]);

  const handleSelect = (prompt: SystemPrompt | null) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (prompt) {
      addRecentPrompt(prompt.id);
    }
    setSearchQuery("");
    setSelectedTag(null);
    onSelect(prompt);
  };

  const handleToggleFavorite = (promptId: string, e: unknown) => {
    if (typeof e === "object" && e !== null && "stopPropagation" in e) {
      (e as { stopPropagation: () => void }).stopPropagation();
    }
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleFavoritePrompt(promptId);
  };

  const handleClose = () => {
    setSearchQuery("");
    setSelectedTag(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
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
            <ThemedText style={styles.title}>{t.selectPrompt}</ThemedText>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <MaterialIcons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          <View
            style={[
              styles.searchContainer,
              {
                backgroundColor: theme.inputBackground,
                ...Shadows.elevation1,
              },
            ]}
          >
            <MaterialIcons
              name="search"
              size={20}
              color={theme.textSecondary}
            />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder={t.searchPrompts}
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")}>
                <MaterialIcons
                  name="clear"
                  size={20}
                  color={theme.textSecondary}
                />
              </Pressable>
            )}
          </View>

          {topTags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tagFilterContainer}
              contentContainerStyle={styles.tagFilterContent}
            >
              <Pressable
                style={[
                  styles.tagChip,
                  {
                    backgroundColor:
                      selectedTag === null ? theme.primary : theme.surface,
                    borderColor:
                      selectedTag === null
                        ? theme.primary
                        : theme.outlineVariant,
                  },
                ]}
                onPress={() => setSelectedTag(null)}
              >
                <ThemedText
                  style={[
                    styles.tagChipText,
                    {
                      color:
                        selectedTag === null ? theme.buttonText : theme.text,
                    },
                  ]}
                >
                  All
                </ThemedText>
              </Pressable>
              {topTags.map((tag) => (
                <Pressable
                  key={tag}
                  style={[
                    styles.tagChip,
                    {
                      backgroundColor:
                        selectedTag === tag ? theme.primary : theme.surface,
                      borderColor:
                        selectedTag === tag
                          ? theme.primary
                          : theme.outlineVariant,
                    },
                  ]}
                  onPress={() =>
                    setSelectedTag(selectedTag === tag ? null : tag)
                  }
                >
                  <ThemedText
                    style={[
                      styles.tagChipText,
                      {
                        color:
                          selectedTag === tag ? theme.buttonText : theme.text,
                      },
                    ]}
                  >
                    {tag.replace(/_/g, " ")}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.noneButton,
              {
                backgroundColor: pressed
                  ? theme.surfaceVariant
                  : theme.backgroundSecondary,
                borderColor: theme.outlineVariant,
              },
            ]}
            onPress={() => handleSelect(null)}
          >
            <MaterialIcons
              name="chat-bubble-outline"
              size={20}
              color={theme.primary}
            />
            <ThemedText style={[styles.noneButtonText, { color: theme.text }]}>
              {t.startWithoutPrompt}
            </ThemedText>
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={theme.textSecondary}
            />
          </Pressable>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            renderSectionHeader={({ section }) => (
              <ThemedText
                style={[styles.sectionHeader, { color: theme.textSecondary }]}
              >
                {section.title}
              </ThemedText>
            )}
            renderItem={({ item }) => {
              const isFavorite = favoritePromptIds.includes(item.id);
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.promptItem,
                    {
                      backgroundColor: pressed
                        ? theme.surfaceVariant
                        : theme.surface,
                      borderColor: theme.outlineVariant,
                    },
                  ]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.promptContent}>
                    <ThemedText style={styles.promptTitle}>
                      {item.title}
                    </ThemedText>
                    {item.tags && item.tags.length > 0 && (
                      <View style={styles.tagPillsContainer}>
                        {item.tags.slice(0, 3).map((tag) => (
                          <View
                            key={tag}
                            style={[
                              styles.tagPill,
                              { backgroundColor: theme.surfaceVariant },
                            ]}
                          >
                            <ThemedText
                              style={[
                                styles.tagPillText,
                                { color: theme.textSecondary },
                              ]}
                            >
                              {tag.replace(/_/g, " ")}
                            </ThemedText>
                          </View>
                        ))}
                      </View>
                    )}
                    <ThemedText
                      style={[
                        styles.promptPreview,
                        { color: theme.textSecondary },
                      ]}
                      numberOfLines={2}
                    >
                      {item.prompt.slice(0, 150)}...
                    </ThemedText>
                  </View>
                  <Pressable
                    style={styles.starButton}
                    onPress={(e) => handleToggleFavorite(item.id, e)}
                  >
                    <MaterialIcons
                      name={isFavorite ? "star" : "star-border"}
                      size={24}
                      color={isFavorite ? theme.primary : theme.textSecondary}
                    />
                  </Pressable>
                  <MaterialIcons
                    name="chevron-right"
                    size={20}
                    color={theme.textSecondary}
                  />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MaterialIcons
                  name="search-off"
                  size={48}
                  color={theme.textSecondary}
                />
                <ThemedText
                  style={[styles.emptyText, { color: theme.textSecondary }]}
                >
                  {t.noPromptsFound}
                </ThemedText>
              </View>
            }
          />
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
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
  },
  title: {
    ...Typography.titleLarge,
    fontWeight: "600",
  },
  closeButton: {
    padding: Spacing.sm,
    marginRight: -Spacing.sm,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.lg,
    height: Spacing.inputHeight,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyLarge,
    marginLeft: Spacing.sm,
    marginRight: Spacing.sm,
  },
  noneButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  noneButtonText: {
    flex: 1,
    ...Typography.bodyLarge,
  },
  listContent: {
    paddingBottom: Spacing["2xl"],
  },
  sectionHeader: {
    ...Typography.labelMedium,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  promptItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  promptContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  promptTitle: {
    ...Typography.titleSmall,
    marginBottom: Spacing.xs,
  },
  promptPreview: {
    ...Typography.bodySmall,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["4xl"],
  },
  emptyText: {
    ...Typography.bodyMedium,
    marginTop: Spacing.md,
  },
  tagFilterContainer: {
    marginBottom: Spacing.md,
  },
  tagFilterContent: {
    paddingHorizontal: Spacing.xs,
    gap: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  tagChipText: {
    ...Typography.labelMedium,
    textTransform: "capitalize",
  },
  tagPillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  tagPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  tagPillText: {
    fontSize: 10,
    textTransform: "capitalize",
  },
  starButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.xs,
  },
});
