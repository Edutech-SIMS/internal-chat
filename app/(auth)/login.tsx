import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { usePushToken } from "../../contexts/PushTokenContext";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { token: expoPushToken } = usePushToken();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        Alert.alert("Login Failed", authError.message);
        return;
      }

      if (!authData?.user) {
        Alert.alert("Error", "No user returned from Supabase.");
        return;
      }

      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, is_system_admin, school_id")
        .eq("id", authData.user.id)
        .single();

      if (profileError) {
        Alert.alert("Error", profileError.message);
        return;
      }

      // Push token registration if available
      if (expoPushToken && profile.id && profile.school_id) {
        try {
          await supabase.from("user_push_tokens").upsert(
            {
              user_id: profile.id,
              school_id: profile.school_id,
              token: expoPushToken,
              device_platform: Platform.OS,
            },
            { onConflict: "user_id,school_id,token" }
          );
          console.log("Push token registered");
        } catch (err) {
          console.error("Failed to save push token:", err);
        }
      }

      // Redirect based on role
      if (profile.is_system_admin) {
        router.replace("/system-admin");
      } else {
        router.replace("/school-splash");
      }
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 24,
        backgroundColor: "#f9fafb",
      }}
    >
      <View
        style={{
          backgroundColor: "white",
          padding: 28,
          borderRadius: 14,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: "700",
            textAlign: "center",
            marginBottom: 12,
            color: "#111",
          }}
        >
          Welcome Back
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: "#555",
            textAlign: "center",
            marginBottom: 28,
          }}
        >
          Hi there 👋 Sign in to keep the conversation going.
        </Text>

        {/* Email */}
        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            paddingVertical: 14,
            paddingHorizontal: 12,
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 16,
            backgroundColor: "#fafafa",
          }}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {/* Password */}
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            paddingVertical: 14,
            paddingHorizontal: 12,
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 16,
            backgroundColor: "#fafafa",
          }}
        />

        {/* Login button */}
        <TouchableOpacity
          onPress={handleLogin}
          disabled={loading}
          style={{
            backgroundColor: loading ? "#9ca3af" : "#007AFF",
            paddingVertical: 16,
            borderRadius: 10,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 17, fontWeight: "600" }}>
              Login
            </Text>
          )}
        </TouchableOpacity>

        {/* Forgot Password */}
        <TouchableOpacity
          onPress={() => router.push("/(auth)/forgot-password")}
        >
          <Text style={{ textAlign: "center", color: "#007AFF", fontSize: 15 }}>
            Forgot your password?
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
