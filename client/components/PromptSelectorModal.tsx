import React, { useState, useMemo } from "react";
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  SectionList,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Spacing, BorderRadius, Typography, Shadows } from "@/constants/theme";
import { SystemPrompt, searchPrompts } from "@/lib/prompts";
import { getDeviceLanguageCode } from "@/lib/locale";

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
  const [searchQuery, setSearchQuery] = useState("");
  const languageCode = useMemo(() => getDeviceLanguageCode(), []);

  const sections = useMemo((): SectionData[] => {
    const filteredPrompts = searchPrompts(searchQuery, languageCode);
    const categories = Array.from(
      new Set(filteredPrompts.map((prompt) => prompt.category)),
    );

    return categories.map((category) => ({
      title: category,
      data: filteredPrompts.filter((p) => p.category === category),
    }));
  }, [languageCode, searchQuery]);

  const handleSelect = (prompt: SystemPrompt | null) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSearchQuery("");
    onSelect(prompt);
  };

  const handleClose = () => {
    setSearchQuery("");
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
            <ThemedText style={styles.title}>Select Prompt</ThemedText>
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
              placeholder="Search prompts..."
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
              Start without prompt
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
            renderItem={({ item }) => (
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
                  <ThemedText
                    style={[
                      styles.promptPreview,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    {item.prompt.slice(0, 100)}...
                  </ThemedText>
                </View>
                <MaterialIcons
                  name="chevron-right"
                  size={20}
                  color={theme.textSecondary}
                />
              </Pressable>
            )}
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
                  No prompts found
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
});
