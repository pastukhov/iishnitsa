import { Platform } from "react-native";

const primaryLight = "#6750A4";
const primaryDark = "#D0BCFF";

export const Colors = {
  light: {
    text: "#1C1B1F",
    textSecondary: "#49454F",
    buttonText: "#FFFFFF",
    tabIconDefault: "#79747E",
    tabIconSelected: primaryLight,
    link: "#6750A4",
    primary: primaryLight,
    primaryContainer: "#EADDFF",
    onPrimaryContainer: "#21005D",
    surface: "#FFFBFE",
    surfaceVariant: "#E7E0EC",
    onSurfaceVariant: "#49454F",
    outline: "#79747E",
    outlineVariant: "#CAC4D0",
    error: "#B3261E",
    errorContainer: "#F9DEDC",
    backgroundRoot: "#FFFBFE",
    backgroundDefault: "#F7F2F9",
    backgroundSecondary: "#E7E0EC",
    backgroundTertiary: "#D9D3E0",
    userBubble: "#6750A4",
    userBubbleText: "#FFFFFF",
    aiBubble: "#E7E0EC",
    aiBubbleText: "#1C1B1F",
    inputBackground: "#F7F2F9",
    success: "#386A20",
    successContainer: "#C4EFAB",
  },
  dark: {
    text: "#E6E1E5",
    textSecondary: "#CAC4D0",
    buttonText: "#381E72",
    tabIconDefault: "#938F99",
    tabIconSelected: primaryDark,
    link: "#D0BCFF",
    primary: primaryDark,
    primaryContainer: "#4F378B",
    onPrimaryContainer: "#EADDFF",
    surface: "#1C1B1F",
    surfaceVariant: "#49454F",
    onSurfaceVariant: "#CAC4D0",
    outline: "#938F99",
    outlineVariant: "#49454F",
    error: "#F2B8B5",
    errorContainer: "#8C1D18",
    backgroundRoot: "#1C1B1F",
    backgroundDefault: "#2B2930",
    backgroundSecondary: "#49454F",
    backgroundTertiary: "#605D66",
    userBubble: "#D0BCFF",
    userBubbleText: "#381E72",
    aiBubble: "#49454F",
    aiBubbleText: "#E6E1E5",
    inputBackground: "#2B2930",
    success: "#A7D48E",
    successContainer: "#1F5209",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
  messagePadding: 12,
  messageMaxWidth: 0.8,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 28,
  "3xl": 32,
  full: 9999,
  message: 16,
};

export const Typography = {
  displayLarge: {
    fontSize: 57,
    fontWeight: "400" as const,
    letterSpacing: -0.25,
  },
  displayMedium: {
    fontSize: 45,
    fontWeight: "400" as const,
  },
  displaySmall: {
    fontSize: 36,
    fontWeight: "400" as const,
  },
  headlineLarge: {
    fontSize: 32,
    fontWeight: "400" as const,
  },
  headlineMedium: {
    fontSize: 28,
    fontWeight: "400" as const,
  },
  headlineSmall: {
    fontSize: 24,
    fontWeight: "400" as const,
  },
  titleLarge: {
    fontSize: 22,
    fontWeight: "400" as const,
  },
  titleMedium: {
    fontSize: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.15,
  },
  titleSmall: {
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: "400" as const,
    letterSpacing: 0.5,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: "400" as const,
    letterSpacing: 0.25,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: "400" as const,
    letterSpacing: 0.4,
  },
  labelLarge: {
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontSize: 12,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
  },
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  h3: {
    fontSize: 24,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 20,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
};

export const Shadows = {
  elevation1: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  elevation2: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  elevation3: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  elevation4: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
