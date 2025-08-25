import { useAuth } from "contexts/AuthContext";
import { Redirect } from "expo-router";
import { supabase } from "lib/supabase";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Text,
  View,
} from "react-native";
export default function SchoolSplash() {
  const { user } = useAuth();
  const [schoolSettings, setSchoolSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);

  // Animation values
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));

  useEffect(() => {
    if (user) {
      fetchSchoolSettings();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchSchoolSettings = async () => {
    try {
      // Get the user's school_id from their profile first
      const { data: profile } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", user?.id)
        .single();

      if (profile?.school_id) {
        // Fetch school settings using the user's school_id
        const { data } = await supabase
          .from("school_settings")
          .select("name, logo_url, theme_color")
          .eq("school_id", profile.school_id)
          .single();

        if (data) {
          setSchoolSettings(data);
        }
      }
    } catch (error) {
      console.error("Error fetching school settings:", error);
    } finally {
      setLoading(false);

      // Start animation
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-redirect after 3 seconds
      setTimeout(() => setShowSplash(false), 3000);
    }
  };

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!showSplash) {
    return <Redirect href="/(tabs)" />;
  }

  const themeColor = schoolSettings?.theme_color || "#007AFF";
  const schoolName = schoolSettings?.name || "School";
  const logoUrl = schoolSettings?.logo_url;

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: themeColor,
      }}
    >
      <Animated.View
        style={{
          alignItems: "center",
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
        }}
      >
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={{
              width: 150,
              height: 150,
              marginBottom: 25,
              borderRadius: 30,
              borderWidth: 3,
              borderColor: "rgba(255,255,255,0.3)",
            }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: 150,
              height: 150,
              marginBottom: 25,
              borderRadius: 30,
              backgroundColor: "rgba(255,255,255,0.2)",
              justifyContent: "center",
              alignItems: "center",
              borderWidth: 3,
              borderColor: "rgba(255,255,255,0.3)",
            }}
          >
            <Text style={{ fontSize: 60, color: "white" }}>🏫</Text>
          </View>
        )}

        <Text
          style={{
            fontSize: 32,
            fontWeight: "bold",
            color: "white",
            textAlign: "center",
            marginBottom: 10,
          }}
        >
          Welcome to
        </Text>

        <Text
          style={{
            fontSize: 36,
            fontWeight: "bold",
            color: "white",
            textAlign: "center",
          }}
        >
          {schoolName}
        </Text>

        <Text
          style={{
            fontSize: 18,
            color: "rgba(255,255,255,0.9)",
            textAlign: "center",
            marginTop: 20,
          }}
        >
          School Chat Platform
        </Text>
      </Animated.View>

      {loading && (
        <ActivityIndicator
          size="large"
          color="white"
          style={{ marginTop: 30 }}
        />
      )}
    </View>
  );
}
