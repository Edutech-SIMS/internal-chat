import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { usePushToken } from "../../contexts/PushTokenContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { loading, signIn, hasRole } = useAuth();
  const router = useRouter();
  const { token: expoPushToken } = usePushToken();

  const handleLogin = async () => {
    console.log("Login attempt started", { email });

    try {
      await signIn(email, password, expoPushToken);
      console.log("Sign in successful", {
        hasSuperAdminRole: hasRole("superadmin"),
        userRoles: hasRole("superadmin") ? "superadmin" : "regular user",
      });

      // Redirect based on role - check for superadmin role
      if (hasRole("superadmin")) {
        console.log("Redirecting to system admin dashboard");
        router.replace("/system-admin");
      } else {
        console.log("Redirecting to school splash");
        router.replace("/school-splash");
      }
    } catch (error: any) {
      console.error("Login failed", {
        email,
        error: error.message,
      });
      Alert.alert("Error", error.message);
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
