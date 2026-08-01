import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  SectionList,
  ScrollView,
  Platform,
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
  MarketplaceSkill,
  MarketplaceSkillAudit,
  extractSkillDescription,
  extractSkillMdContent,
  getCuratedSkills,
  getMarketplaceSkillAudit,
  getMarketplaceSkillDetail,
  searchMarketplaceSkills,
} from "@/lib/skills-marketplace";

interface SkillMarketplaceModalProps {
  visible: boolean;
  onClose: () => void;
}

interface OwnerSection {
  title: string;
  data: MarketplaceSkill[];
}

const AUDIT_STATUS_ICON: Record<MarketplaceSkillAudit["status"], string> = {
  pass: "check-circle",
  warn: "warning",
  fail: "error",
};

export function SkillMarketplaceModal({
  visible,
  onClose,
}: SkillMarketplaceModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    settings: { skills },
    addSkill,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [curatedSections, setCuratedSections] = useState<OwnerSection[]>([]);
  const [searchResults, setSearchResults] = useState<MarketplaceSkill[] | null>(
    null,
  );

  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailContent, setDetailContent] = useState<string | null>(null);
  const [detailHash, setDetailHash] = useState<string | null>(null);
  const [detailAudits, setDetailAudits] = useState<
    MarketplaceSkillAudit[] | null
  >(null);
  const [isInstalling, setIsInstalling] = useState(false);

  const loadCurated = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await getCuratedSkills();
      setCuratedSections(
        result.data.map((owner) => ({
          title: `${owner.owner} (${owner.totalInstalls})`,
          data: owner.skills,
        })),
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to load skills.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && curatedSections.length === 0 && !isLoading) {
      loadCurated();
    }
  }, [visible, curatedSections.length, isLoading, loadCurated]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    const timeout = setTimeout(async () => {
      try {
        const result = await searchMarketplaceSkills(query, { limit: 50 });
        setSearchResults(result.data);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Search failed.");
      } finally {
        setIsLoading(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const sections: OwnerSection[] = useMemo(() => {
    if (searchResults !== null) {
      return [{ title: "Search Results", data: searchResults }];
    }
    return curatedSections;
  }, [searchResults, curatedSections]);

  const installedSourceIds = useMemo(
    () => new Set(skills.map((s) => s.sourceId).filter(Boolean)),
    [skills],
  );

  const handleClose = () => {
    setSearchQuery("");
    setSearchResults(null);
    onClose();
  };

  const openDetail = async (skill: MarketplaceSkill) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedSkill(skill);
    setDetailContent(null);
    setDetailHash(null);
    setDetailAudits(null);
    setDetailLoading(true);
    try {
      const [detail, audit] = await Promise.all([
        getMarketplaceSkillDetail(skill.id),
        getMarketplaceSkillAudit(skill.id),
      ]);
      setDetailContent(
        extractSkillMdContent(detail.files) || "No SKILL.md found.",
      );
      setDetailHash(detail.hash);
      setDetailAudits(audit?.audits ?? []);
    } catch (error) {
      setDetailContent(
        error instanceof Error ? error.message : "Failed to load skill.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedSkill(null);
    setDetailContent(null);
    setDetailHash(null);
    setDetailAudits(null);
  };

  const handleInstall = () => {
    if (!selectedSkill || !detailContent) return;
    setIsInstalling(true);
    addSkill({
      name: selectedSkill.name,
      description: extractSkillDescription(detailContent),
      content: detailContent,
      enabled: false,
      sourceId: selectedSkill.id,
      sourceHash: detailHash ?? undefined,
    });
    setIsInstalling(false);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Toast.show({
      type: "success",
      text1: "Skill installed",
      text2: "Enable it in Settings > Skills to use it.",
      visibilityTime: 4000,
    });
    closeDetail();
  };

  const isSelectedInstalled = selectedSkill
    ? installedSourceIds.has(selectedSkill.id)
    : false;

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
            <ThemedText style={styles.title}>Skills Marketplace</ThemedText>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
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
              placeholder="Search skills.sh..."
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              accessibilityLabel="Search skills"
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

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : loadError ? (
            <View style={styles.loadingContainer}>
              <ThemedText style={{ color: theme.error }}>
                {loadError}
              </ThemedText>
              <Pressable
                onPress={loadCurated}
                style={[styles.retryButton, { backgroundColor: theme.primary }]}
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : (
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
                const isInstalled = installedSourceIds.has(item.id);
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.skillItem,
                      {
                        backgroundColor:
                          Platform.OS === "ios" && pressed
                            ? theme.surfaceVariant
                            : theme.surface,
                        borderColor: theme.outlineVariant,
                      },
                    ]}
                    onPress={() => openDetail(item)}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                  >
                    <View style={styles.skillContent}>
                      <ThemedText style={styles.skillName}>
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.skillSource,
                          { color: theme.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {item.source} · {item.installs} installs
                      </ThemedText>
                    </View>
                    {isInstalled && (
                      <MaterialIcons
                        name="check-circle"
                        size={20}
                        color={theme.success}
                      />
                    )}
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
                  <ThemedText style={{ color: theme.textSecondary }}>
                    No skills found.
                  </ThemedText>
                </View>
              }
            />
          )}
        </ThemedView>
      </View>

      <Modal
        visible={!!selectedSkill}
        animationType="slide"
        transparent
        onRequestClose={closeDetail}
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
                {selectedSkill?.name}
              </ThemedText>
              <Pressable
                onPress={closeDetail}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [
                  styles.closeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <MaterialIcons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>

            {detailLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : (
              <>
                {detailAudits && detailAudits.length > 0 && (
                  <View style={styles.auditRow}>
                    {detailAudits.map((audit) => {
                      const color =
                        audit.status === "pass"
                          ? theme.success
                          : audit.status === "warn"
                            ? theme.warning
                            : theme.error;
                      const containerColor =
                        audit.status === "pass"
                          ? theme.successContainer
                          : audit.status === "warn"
                            ? theme.warningContainer
                            : theme.errorContainer;
                      return (
                        <View
                          key={audit.slug}
                          style={[
                            styles.auditBadge,
                            { backgroundColor: containerColor },
                          ]}
                        >
                          <MaterialIcons
                            name={AUDIT_STATUS_ICON[audit.status] as any}
                            size={14}
                            color={color}
                          />
                          <ThemedText style={[styles.auditText, { color }]}>
                            {audit.provider}
                          </ThemedText>
                        </View>
                      );
                    })}
                  </View>
                )}

                <ThemedText
                  style={[styles.warningNote, { color: theme.textSecondary }]}
                >
                  Community-submitted content — review before enabling.
                  Installed skills start disabled.
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
                    {detailContent}
                  </ThemedText>
                </ScrollView>

                <Pressable
                  onPress={handleInstall}
                  disabled={isInstalling || isSelectedInstalled}
                  style={({ pressed }) => [
                    styles.installButton,
                    {
                      backgroundColor: isSelectedInstalled
                        ? theme.surfaceVariant
                        : theme.primary,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      color: isSelectedInstalled
                        ? theme.textSecondary
                        : theme.buttonText,
                    }}
                  >
                    {isSelectedInstalled ? "Already installed" : "Install"}
                  </ThemedText>
                </Pressable>
              </>
            )}
          </ThemedView>
        </View>
      </Modal>
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
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
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
  skillItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  skillContent: {
    flex: 1,
  },
  skillName: {
    ...Typography.titleSmall,
    marginBottom: Spacing.xs,
  },
  skillSource: {
    ...Typography.bodySmall,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["4xl"],
  },
  auditRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  auditBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  auditText: {
    fontSize: 11,
    fontWeight: "500",
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
