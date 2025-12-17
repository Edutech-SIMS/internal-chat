import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useEffect } from "react";
import { EventRegister } from "react-native-event-listeners";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { getThemeColors } from "../../themes";

export default function TabLayout() {
  const { hasRole, profile, loading } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  useEffect(() => {
    console.log("TabLayout - isDarkMode updated:", isDarkMode);
    console.log("TabLayout - new colors:", colors);
  }, [isDarkMode]);

  const isParent = !loading && profile?.roles ? hasRole("parent") : false;
  const isTeacher = !loading && profile?.roles ? hasRole("teacher") : false;
  const isAdminUser =
    !loading && profile?.roles
      ? hasRole("admin") || hasRole("superadmin")
      : false;

  const insets = useSafeAreaInsets();

  const tabBarStyle = {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: insets.bottom > 0 ? insets.bottom : 20,
    height: 60 + (insets.bottom > 0 ? insets.bottom : 20),
  };

  // Don't render tabs while loading auth state
  if (loading) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: "#ffffff",
        headerTitleStyle: {
          fontWeight: "bold",
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: isDarkMode ? "#8e8e93" : "#8e8e93",
        tabBarStyle: tabBarStyle,
      }}
    >
      {/* Admin Dashboard - First for admins */}
      <Tabs.Screen
        name="admin"
        options={{
          title: "Dashboard",
          href: isAdminUser ? "/admin" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "grid" : "grid-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Parent-specific tabs */}
      <Tabs.Screen
        name="parent"
        options={{
          title: "My Children",
          href: isParent ? "/parent" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "people" : "people-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Teacher-specific tabs */}
      <Tabs.Screen
        name="teacher"
        options={{
          title: "My Class",
          href: isTeacher ? "/teacher" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "school" : "school-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Chat Tab - Available to all users */}
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "chatbubbles" : "chatbubbles-outline"}
              size={size}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: () => EventRegister.emit("refreshChats"),
        }}
      />

      <Tabs.Screen
        name="billing"
        options={{
          title: "Billing",
          href: isParent ? "/billing" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "wallet" : "wallet-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Shared Attendance tab for parents and teachers */}
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          href: isTeacher ? "/attendance" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="groups"
        options={{
          title: "Groups",
          href: isAdminUser ? "/groups" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "git-branch" : "git-branch-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Settings Tab - Available to all users */}
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "settings" : "settings-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
