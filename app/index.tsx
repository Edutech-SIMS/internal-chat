import * as Notifications from "expo-notifications";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { usePushToken } from "../contexts/PushTokenContext";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotificationsAsync(): Promise<
  string | undefined
> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Push notifications permission denied");
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  console.log("Expo push token:", tokenData.data);
  return tokenData.data;
}

export default function Splash() {
  const { user, loading: authLoading } = useAuth();
  const { setToken } = usePushToken();
  const [ready, setReady] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));

  const splashThemeColor = "#7489FF";
  const splashLogoUrl = require("../assets/images/edutechsystems-logo.png");

  // Request permission and store token in PushContext
  useEffect(() => {
    const initPush = async () => {
      const token = await registerForPushNotificationsAsync();
      if (token) setToken(token);
    };
    initPush();
  }, [setToken]);

  // Android notification channel
  useEffect(() => {
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }
  }, []);

  // Splash fade-in animation
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 300);

    const timer = setTimeout(() => setReady(true), 2500);

    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, []);

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
              source={splashLogoUrl}
              style={{ width: 250, height: 150, marginBottom: 10 }}
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
  if (user) {
    const { hasRole } = useAuth();
    if (hasRole("teacher")) {
      return <Redirect href="/teacher" />;
    }
    if (hasRole("parent")) {
      return <Redirect href="/parent" />;
    }
    if (hasRole("admin") || hasRole("superadmin")) {
      return <Redirect href="/users" />;
    }
    return <Redirect href="/chats" />;
  }

  return <Redirect href="/(auth)/login" />;
}
