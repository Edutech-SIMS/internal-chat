import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedText } from "./ThemedText";

import { useAuth } from "../contexts/AuthContext";

const { width } = Dimensions.get("window");

export default function SchoolSplash() {
  const { user, loading: authLoading, school, hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Animation values
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));
  const [textTranslateY] = useState(new Animated.Value(20));

  useEffect(() => {
    // Start animations when component mounts
    Animated.stagger(300, [
      // 1. Fade in and scale up the main container (Logo)
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]),
      // 2. Slide up the text
      Animated.spring(textTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Set loading to false after animations complete
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && school) {
      // Small delay to ensure the user sees the "loaded" state momentarily
      const redirectTimer = setTimeout(() => {
        if (hasRole("teacher")) {
          router.replace("/teacher");
        } else if (hasRole("parent")) {
          router.replace("/parent");
        } else if (hasRole("admin")) {
          router.replace("/admin");
        } else {
          router.replace("/chats");
        }
      }, 500);

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
    <LinearGradient
      colors={["#007AFF", "#0040A0", "#001F5C"]}
      style={styles.container}
    >
      <SafeAreaView style={styles.content}>
        <Animated.View
          style={[
            styles.animatedContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }, { translateY: textTranslateY }],
            },
          ]}
        >
          {/* Logo Container with Glassmorphism Effect */}
          <View style={styles.logoContainer}>
            {logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={styles.logo}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholderLogo}>
                <ThemedText style={styles.placeholderIcon}>🏫</ThemedText>
              </View>
            )}
          </View>

          <View style={styles.textContainer}>
            <ThemedText style={styles.welcomeText}>WELCOME TO</ThemedText>
            <ThemedText type="title" style={styles.schoolName}>
              {schoolName}
            </ThemedText>
          </View>

          {loading && (
            <ActivityIndicator
              size="large"
              color="white"
              style={styles.loader}
            />
          )}
        </Animated.View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            position: "absolute",
            bottom: 40,
          }}
        >
          <ThemedText style={styles.poweredBy}>Powered by MindSync</ThemedText>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  animatedContainer: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 20,
  },
  logoContainer: {
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  logo: {
    width: 140,
    height: 140,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  placeholderLogo: {
    width: 140,
    height: 140,
    borderRadius: 35,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  placeholderIcon: {
    fontSize: 60,
    color: "white",
  },
  textContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  welcomeText: {
    fontSize: 14,
    // fontFamily: "PlusJakartaSans-SemiBold", // Handled by ThemedText/fontWeight mapping if strict, but here I can use type or just let it be.
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: "center",
  },
  schoolName: {
    fontSize: 32,
    // fontFamily: "PlusJakartaSans-Bold", // Handled by type="title"
    color: "white",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.2)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    paddingHorizontal: 10,
    lineHeight: 40,
  },
  loader: {
    marginTop: 40,
  },
  poweredBy: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    // fontFamily: "PlusJakartaSans-Medium",
  },
});
