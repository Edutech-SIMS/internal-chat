import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { EventRegister } from "react-native-event-listeners";
import { useAuth } from "../../contexts/AuthContext";

export default function TabLayout() {
  const { isAdmin } = useAuth(); // no loading/user redirect here

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: () => EventRegister.emit("refreshChats"),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: "Groups",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: () => EventRegister.emit("refreshGroups"),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
          href: isAdmin ? "/admin" : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
