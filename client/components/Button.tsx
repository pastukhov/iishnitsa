import React, { ReactNode, useMemo } from "react";
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  Platform,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

interface ButtonProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: "filled" | "outlined" | "text";
}

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  onPress,
  children,
  style,
  disabled = false,
  variant = "filled",
}: ButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled) {
      scale.value = withSpring(0.98, springConfig);
    }
  };

  const handlePressOut = () => {
    if (!disabled) {
      scale.value = withSpring(1, springConfig);
    }
  };

  const variantStyles = useMemo(() => {
    switch (variant) {
      case "outlined":
        return {
          container: {
            backgroundColor: "transparent" as const,
            borderWidth: 1,
            borderColor: theme.outline,
          },
          text: { color: theme.primary },
        };
      case "text":
        return {
          container: { backgroundColor: "transparent" as const },
          text: { color: theme.primary },
        };
      default:
        return {
          container: { backgroundColor: theme.link },
          text: { color: theme.buttonText },
        };
    }
  }, [variant, theme]);

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={{
        color:
          variant === "filled" ? theme.primaryContainer : theme.surfaceVariant,
        borderless: false,
      }}
      style={({ pressed }: { pressed: boolean }) => [
        styles.button,
        variantStyles.container,
        { opacity: disabled ? 0.5 : 1 },
        Platform.OS === "ios" && pressed && { opacity: 0.7 },
        style,
        animatedStyle,
      ]}
    >
      <ThemedText type="body" style={[styles.buttonText, variantStyles.text]}>
        {children}
      </ThemedText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontWeight: "600",
  },
});
