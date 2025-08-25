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
  const [ready, setReady] = useState(false);

  // Hardcoded splash screen values
  const splashThemeColor = "#007AFF"; // Default blue, you can change this
  const splashLogoUrl = null; // Or use a local asset: require('../assets/splash-icon.png')
  const splashSchoolName = "School App"; // Default app name

  // Fade-in animation
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Start fade animation after a short delay
    const fadeTimer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 300);

    if (!user) {
      checkAdminExists();
    } else {
      setCheckingAdmin(false);
    }

    // Always show splash for at least 2.5s
    const timer = setTimeout(() => setReady(true), 2500);

    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, [user]);

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

  // Show hardcoded splash screen
  if (authLoading || checkingAdmin || !ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: splashThemeColor,
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
          {splashLogoUrl ? (
            <Image
              source={{ uri: splashLogoUrl }}
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
          ) : (
            // Fallback icon if no logo
            <View
              style={{
                width: 140,
                height: 140,
                marginBottom: 20,
                borderRadius: 30,
                backgroundColor: "rgba(255,255,255,0.2)",
                justifyContent: "center",
                alignItems: "center",
                borderWidth: 2,
                borderColor: "rgba(255,255,255,0.3)",
              }}
            >
              <Text style={{ fontSize: 60, color: "white" }}>🏫</Text>
            </View>
          )}

          <Text
            style={{
              fontSize: 28,
              fontWeight: "bold",
              color: "white",
              textAlign: "center",
            }}
          >
            {splashSchoolName}
          </Text>
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
