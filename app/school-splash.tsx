import { useAuth } from "contexts/AuthContext";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  ImageBackground,
  Text,
  View,
} from "react-native";

export default function SchoolSplash() {
  const { user, loading: authLoading, school, hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Animation values
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));

  useEffect(() => {
    // Start animations when component mounts
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        speed: 10,
        useNativeDriver: true,
      }),
    ]).start();

    // Set loading to false after animations complete
    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && school) {
      const redirectTimer = setTimeout(() => {
        if (hasRole("teacher")) {
          router.replace("/teacher");
        } else if (hasRole("parent")) {
          router.replace("/parent");
        } else if (hasRole("admin") || hasRole("superadmin")) {
          router.replace("/admin");
        } else {
          router.replace("/chats");
        }
      }, 2000);

      return () => clearTimeout(redirectTimer);
    }
  }, [loading, school, hasRole]);

  if (authLoading) {
    return null;
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  const schoolName = school?.name || "School";
  const logoUrl = school?.logo_url;

  return (
    <ImageBackground
      source={require("../assets/images/school-scribbles.png")}
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#007AFF", // Fallback color
      }}
      resizeMode="cover"
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
          School Management and Communication Platform
        </Text>
      </Animated.View>

      {loading && (
        <ActivityIndicator
          size="large"
          color="white"
          style={{ marginTop: 30 }}
        />
      )}
    </ImageBackground>
  );
}
