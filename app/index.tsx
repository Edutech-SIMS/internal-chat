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

export default function Splash() {
  const { user, loading: authLoading } = useAuth();
  const [ready, setReady] = useState(false);

  const splashThemeColor = "#7489FF";
  let splashLogoUrl = require("../assets/images/edutechsystems-logo.png");

  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Fade-in animation
    const fadeTimer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 300);

    // Ensure splash shows for at least 2.5s
    const timer = setTimeout(() => setReady(true), 2500);

    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, []);

  // While waiting for auth or splash timer
  if (authLoading || !ready) {
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
              source={require("../assets/images/edutechsystems-logo.png")}
              style={{
                width: 250,
                height: 150,
                marginBottom: 10,
              }}
              resizeMode="contain"
            />
          ) : (
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
        </Animated.View>

        <ActivityIndicator
          size="large"
          color="white"
          style={{ marginTop: 10 }}
        />
      </View>
    );
  }

  // Redirect after splash
  return user ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />;
}
