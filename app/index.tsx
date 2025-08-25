import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export default function Splash() {
  const { user, loading: authLoading } = useAuth();

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [adminExists, setAdminExists] = useState(false);

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [themeColor, setThemeColor] = useState<string | null>(null);

  const [ready, setReady] = useState(false);

  // Fade-in animation
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    fetchSettings();

    if (!user) {
      checkAdminExists();
    } else {
      setCheckingAdmin(false);
    }

    // Always show splash for at least 2.5s
    const timer = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(timer);
  }, [user]);

  const fetchSettings = async () => {
    try {
      const { data } = await supabase
        .from("school_settings")
        .select("school_id, logo_url, name, theme_color")
        .limit(1)
        .single();

      if (data) {
        setSchoolName(data.name ?? null);
        setLogoUrl(data.logo_url ?? null);
        setThemeColor(data.theme_color ?? null);
      }
    } finally {
      setLoadingSettings(false);

      // Trigger fade-in after settings load
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  };

  const checkAdminExists = async () => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin")
        .limit(1);

      setAdminExists(Boolean(data && data.length > 0));
    } finally {
      setCheckingAdmin(false);
    }
  };

  // 🚫 Don’t render splash until themeColor is loaded
  if (!themeColor) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "black", // safe neutral loader bg (optional)
        }}
      >
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  // Splash screen
  if (authLoading || checkingAdmin || loadingSettings || !ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: themeColor, // ✅ only real theme color
          paddingHorizontal: 20,
        }}
      >
        <Animated.View
          style={{
            alignItems: "center",
            opacity: fadeAnim,
            transform: [
              {
                scale: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.95, 1],
                }),
              },
            ],
          }}
        >
          {logoUrl ? (
            <Image
              source={{ uri: logoUrl }}
              style={{
                width: 140,
                height: 140,
                marginBottom: 20,
                borderRadius: 30,
                borderWidth: 2,
                borderColor: "rgba(255,255,255,0.3)",
                shadowColor: "#000",
                shadowOpacity: 0.2,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
              resizeMode="cover"
            />
          ) : null}

          {schoolName ? (
            <Text
              style={{
                fontSize: 28,
                fontWeight: "bold",
                color: "white",
                textAlign: "center",
              }}
            >
              {schoolName}
            </Text>
          ) : null}
        </Animated.View>

        <ActivityIndicator
          size="large"
          color="white"
          style={{ marginTop: 30 }}
        />
      </View>
    );
  }

  // Auth redirect flow
  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  if (!adminExists) {
    return <Redirect href="/(auth)/admin-signup" />;
  }

  return <Redirect href="/(auth)/login" />;
}
