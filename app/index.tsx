import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [adminExists, setAdminExists] = useState(false);

  useEffect(() => {
    // Only check admin if no user is logged in
    if (!user) {
      checkAdminExists();
    } else {
      setCheckingAdmin(false);
    }
  }, [user]);

  const checkAdminExists = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin")
        .limit(1);

      if (error) {
        console.error("Error checking admin:", error);
        setAdminExists(true); // fallback: assume admin exists
      } else {
        setAdminExists(data && data.length > 0);
      }
    } catch (error) {
      console.error("Error checking admin:", error);
      setAdminExists(true);
    } finally {
      setCheckingAdmin(false);
    }
  };

  // Loading state while auth or admin check is happening
  if (authLoading || checkingAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Checking system...</Text>
      </View>
    );
  }

  // User is logged in → go to main app
  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  // No user → decide login vs setup
  if (!adminExists) {
    return <Redirect href="/(auth)/admin-signup" />; // first-time setup
  }

  // Default → login page
  return <Redirect href="/(auth)/login" />;
}
