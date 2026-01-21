import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DrawerNavigator from "@/navigation/DrawerNavigator";
import SettingsScreen from "@/screens/SettingsScreen";
import AboutScreen from "@/screens/AboutScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useTheme } from "@/hooks/useTheme";
import { getTranslations } from "@/lib/translations";

export type RootStackParamList = {
  Main: undefined;
  Settings: undefined;
  About: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: false });
  const { theme } = useTheme();
  const t = getTranslations();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        component={DrawerNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          presentation: "modal",
          headerTitle: t.settings,
          headerStyle: {
            backgroundColor: theme.backgroundRoot,
          },
          headerTintColor: theme.text,
        }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{
          presentation: "modal",
          headerTitle: t.about,
          headerStyle: {
            backgroundColor: theme.backgroundRoot,
          },
          headerTintColor: theme.text,
        }}
      />
    </Stack.Navigator>
  );
}
