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
  View,
} from "react-native";
import { ThemedText } from "../components/ThemedText";
import { useAuth } from "../contexts/AuthContext";
import { usePushToken } from "../contexts/PushTokenContext";

const AnimatedThemedText = Animated.createAnimatedComponent(ThemedText);

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
            <AnimatedThemedText
              style={[
                styles.floatingIcon,
                { top: "15%", left: "10%", opacity: fadeAnim },
              ]}
            >
              📚
            </AnimatedThemedText>
            <AnimatedThemedText
              style={[
                styles.floatingIcon,
                { top: "25%", right: "15%", opacity: fadeAnim },
              ]}
            >
              ✏️
            </AnimatedThemedText>
            <AnimatedThemedText
              style={[
                styles.floatingIcon,
                { bottom: "30%", left: "15%", opacity: fadeAnim },
              ]}
            >
              🎓
            </AnimatedThemedText>
            <AnimatedThemedText
              style={[
                styles.floatingIcon,
                { bottom: "20%", right: "10%", opacity: fadeAnim },
              ]}
            >
              🔬
            </AnimatedThemedText>
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
            <View style={styles.logoContainer}>
              <View style={styles.logoInner}>
                <Image
                  source={require("../assets/images/mind-dark-new.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
            </View>

            {/* App Name */}
            <ThemedText type="title" style={styles.appName}>
              MindSync
            </ThemedText>
            <ThemedText style={styles.tagline}>
              School Management System
            </ThemedText>

            {/* Loading Indicator */}
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="rgba(255,255,255,0.9)" />
              <ThemedText style={styles.loadingText}>Loading...</ThemedText>
            </View>
          </Animated.View>

          {/* Bottom Decoration */}
          <View style={styles.bottomDecoration}>
            <View style={styles.decorativeLine} />
            <ThemedText style={styles.poweredBy}>
              Powered by MindSync
            </ThemedText>
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
    if (hasRole("admin")) {
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
  logoContainer: {
    marginBottom: 40,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 20,
    },
    shadowOpacity: 0.35,
    shadowRadius: 25,
    elevation: 20,
  },
  logoInner: {
    width: 160,
    height: 160,
    backgroundColor: "#ffffff",
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  appName: {
    fontSize: 52,
    color: "#FFFFFF",
    letterSpacing: 1.5,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
    marginBottom: 8,
    fontWeight: "800",
  },
  tagline: {
    fontSize: 18,
    color: "rgba(255, 255, 255, 0.9)",
    letterSpacing: 0.5,
    marginBottom: 50,
    textAlign: "center",
    fontWeight: "500",
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: 10,
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    flexDirection: "row",
    gap: 12,
  },
  loadingText: {
    color: "rgba(255, 255, 255, 0.95)",
    fontSize: 15,
    fontFamily: "PlusJakartaSans-Regular",
    letterSpacing: 0.5,
    marginTop: 0,
  },
  bottomDecoration: {
    position: "absolute",
    bottom: 50,
    alignItems: "center",
  },
  decorativeLine: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: 2,
    marginBottom: 16,
  },
  poweredBy: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 13,
    fontFamily: "PlusJakartaSans-Medium",
    letterSpacing: 0.8,
  },
});
