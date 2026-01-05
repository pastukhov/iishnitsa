import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DrawerNavigator from "@/navigation/DrawerNavigator";
import SettingsScreen from "@/screens/SettingsScreen";
import AboutScreen from "@/screens/AboutScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useTheme } from "@/hooks/useTheme";

export type RootStackParamList = {
  Main: undefined;
  Settings: undefined;
  About: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: false });
  const { theme } = useTheme();

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
          headerTitle: "Settings",
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
          headerTitle: "About",
          headerStyle: {
            backgroundColor: theme.backgroundRoot,
          },
          headerTintColor: theme.text,
        }}
      />
    </Stack.Navigator>
  );
}
