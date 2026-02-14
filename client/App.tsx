import React, { useEffect, useState } from "react";
import {
  Appearance,
  StyleSheet,
  View,
  ActivityIndicator,
  Image,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useChatStore } from "@/lib/store";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

function AppContent() {
  const loadFromStorage = useChatStore((state) => state.loadFromStorage);
  const themeSetting = useChatStore((state) => state.settings.theme);
  const { theme } = useTheme();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    loadFromStorage().then(() => setIsHydrated(true));
  }, [loadFromStorage]);

  useEffect(() => {
    Appearance.setColorScheme(themeSetting === "system" ? null : themeSetting);
  }, [themeSetting]);

  const statusBarStyle =
    themeSetting === "system"
      ? "auto"
      : themeSetting === "dark"
        ? "light"
        : "dark";

  if (!isHydrated) {
    return (
      <View
        style={[
          styles.splashContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <Image
          source={require("../assets/images/icon.png")}
          style={styles.splashIcon}
        />
        <ActivityIndicator
          size="large"
          color={theme.primary}
          style={styles.splashSpinner}
        />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer>
        <RootStackNavigator />
      </NavigationContainer>
      <StatusBar style={statusBarStyle} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <GestureHandlerRootView style={styles.root}>
            <KeyboardProvider>
              <AppContent />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splashContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  splashIcon: {
    width: 120,
    height: 120,
  },
  splashSpinner: {
    marginTop: Spacing["2xl"],
  },
});
