import React from "react";
import { View, Image, Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { MessageAttachment } from "@/lib/store";
import { BorderRadius, Spacing } from "@/constants/theme";

interface AttachedImageProps {
  attachment: MessageAttachment;
  onRemove?: () => void;
  size?: "preview" | "bubble";
}

export function AttachedImage({
  attachment,
  onRemove,
  size = "bubble",
}: AttachedImageProps) {
  const { theme } = useTheme();

  const isPreview = size === "preview";
  const imageSize = isPreview ? 80 : 200;

  const aspectRatio =
    attachment.width && attachment.height
      ? attachment.width / attachment.height
      : 1;

  const width = isPreview
    ? imageSize
    : Math.min(imageSize, imageSize * aspectRatio);
  const height = isPreview ? imageSize : width / aspectRatio;

  return (
    <View style={[styles.container, isPreview && styles.previewContainer]}>
      <Image
        source={{ uri: attachment.uri }}
        style={[
          styles.image,
          {
            width,
            height,
            borderColor: theme.outlineVariant,
          },
        ]}
        resizeMode="cover"
      />
      {onRemove && (
        <Pressable
          onPress={onRemove}
          style={[styles.removeButton, { backgroundColor: theme.error }]}
        >
          <MaterialIcons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    marginVertical: Spacing.xs,
  },
  previewContainer: {
    marginRight: Spacing.sm,
  },
  image: {
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  removeButton: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
});
