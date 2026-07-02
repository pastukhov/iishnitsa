import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/useColorScheme";

export function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = Colors[colorScheme === "dark" ? "dark" : "light"];

  return {
    theme,
    isDark,
  };
}
