import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { EventRegister } from "react-native-event-listeners";
import { useAuth } from "../../contexts/AuthContext";

export default function TabLayout() {
  const { hasRole, profile, loading } = useAuth();
  const isParent = !loading && profile?.roles ? hasRole("parent") : false;
  const isTeacher = !loading && profile?.roles ? hasRole("teacher") : false;
  const isAdminUser =
    !loading && profile?.roles
      ? hasRole("admin") || hasRole("superadmin")
      : false;

  const tabBarStyle = {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingBottom: 20,
    height: 70,
  };

  // Don't render tabs while loading auth state
  if (loading) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: "#007AFF",
        },
        headerTintColor: "#ffffff",
        headerTitleStyle: {
          fontWeight: "bold",
        },
        tabBarActiveTintColor: "#007AFF",
        tabBarInactiveTintColor: "#8e8e93",
        tabBarStyle: tabBarStyle,
      }}
    >
      {/* Chat Tab - Available to all users */}
      <Tabs.Screen
        name="index"
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

      {/* Shared Attendance tab for parents and teachers */}
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          href: isParent || isTeacher ? "/attendance" : null,
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
        name="students"
        options={{
          title: "Users",
          href: isAdminUser ? "/students" : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
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

      {/* Profile Tab - Available to all users */}
      <Tabs.Screen
        name="profile"
        options={{
          title: profile?.full_name || "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
