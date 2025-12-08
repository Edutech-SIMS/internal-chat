import { LinearGradient } from "expo-linear-gradient";
import * as Notifications from "expo-notifications";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { usePushToken } from "../contexts/PushTokenContext";

const { width, height } = Dimensions.get("window");

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
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Push notifications permission denied");
      return;
    }

    // Note: Push notifications are not fully supported in Expo Go (SDK 53+)
    // This will work in development builds
    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log("Expo push token:", tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.log(
      "Push notification registration failed (expected in Expo Go):",
      error
    );
    return undefined;
  }
}

export default function Splash() {
  const { user, loading: authLoading } = useAuth();
  const { setToken } = usePushToken();
  const [ready, setReady] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));
  const [rotateAnim] = useState(new Animated.Value(0));

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

  // Splash animations
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 20,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    // Subtle rotation animation for decorative elements
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    const timer = setTimeout(() => setReady(true), 2500);

    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  if (authLoading || !ready) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={["#1E3A8A", "#1E40AF", "#3B82F6"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* Floating Decorative Icons */}
          <View style={styles.floatingIconsContainer}>
            <Animated.Text
              style={[
                styles.floatingIcon,
                { top: "15%", left: "10%", opacity: fadeAnim },
              ]}
            >
              📚
            </Animated.Text>
            <Animated.Text
              style={[
                styles.floatingIcon,
                { top: "25%", right: "15%", opacity: fadeAnim },
              ]}
            >
              ✏️
            </Animated.Text>
            <Animated.Text
              style={[
                styles.floatingIcon,
                { bottom: "30%", left: "15%", opacity: fadeAnim },
              ]}
            >
              🎓
            </Animated.Text>
            <Animated.Text
              style={[
                styles.floatingIcon,
                { bottom: "20%", right: "10%", opacity: fadeAnim },
              ]}
            >
              🔬
            </Animated.Text>
          </View>

          {/* Main Content */}
          <Animated.View
            style={[
              styles.content,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {/* Logo Container */}
            <View style={styles.logoWrapper}>
              <Image
                source={require("../assets/images/mind_dark.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            {/* App Name */}
            <Text style={styles.appName}>MindSync</Text>
            <Text style={styles.tagline}>School Management System</Text>

            {/* Loading Indicator */}
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="white" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          </Animated.View>

          {/* Bottom Decoration */}
          <View style={styles.bottomDecoration}>
            <View style={styles.decorativeLine} />
            <Text style={styles.poweredBy}>Powered by MindSync</Text>
          </View>
        </LinearGradient>
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
      return <Redirect href="/admin" />;
    }
    return <Redirect href="/chats" />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scribbleContainer: {
    position: "absolute",
    width: width * 1.5,
    height: height * 1.5,
    justifyContent: "center",
    alignItems: "center",
  },
  scribbles: {
    width: "100%",
    height: "100%",
    opacity: 0.08,
  },
  floatingIconsContainer: {
    position: "absolute",
    width: "100%",
    height: "100%",
  },
  floatingIcon: {
    position: "absolute",
    fontSize: 32,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  logoWrapper: {
    marginBottom: 24,
  },
  logo: {
    width: 180,
    height: 180,
  },
  appName: {
    fontSize: 48,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 2,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.95)",
    letterSpacing: 1,
    marginBottom: 40,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: 20,
  },
  loadingText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  bottomDecoration: {
    position: "absolute",
    bottom: 40,
    alignItems: "center",
  },
  decorativeLine: {
    width: 60,
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
    marginBottom: 12,
  },
  poweredBy: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
