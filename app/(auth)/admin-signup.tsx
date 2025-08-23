import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, Button, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

export default function AdminSignup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAdminSignup = async () => {
    if (!email || !password || !fullName) {
      Alert.alert("Error", "Please fill all fields");
      return;
    }

    setLoading(true);

    try {
      // Check if any admin already exists
      const { data: existingAdmins, error: checkError } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin");

      if (checkError) throw checkError;
      if (existingAdmins?.length > 0) {
        Alert.alert("Error", "An admin already exists.");
        return;
      }

      // Create the user auth account
      const { data: authData, error: signUpError } = await supabase.auth.signUp(
        {
          email,
          password,
        }
      );

      if (signUpError) throw signUpError;
      if (!authData.user) throw new Error("No user data returned");

      console.log("User created:", authData.user.id);
      const serviceKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92Z2twbnl5aWdpcHV3c2duanJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTk2NDExMSwiZXhwIjoyMDcxNTQwMTExfQ.9ovVbEqiU5amiVkQ6xbXl1wEu2gW0Xig0JP3rIC5Tak";

      // Use service role key to bypass RLS - CORRECTED HEADERS
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/profiles`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            id: authData.user.id,
            email: email,
            full_name: fullName,
            role: "admin",
          }),
        }
      );

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log("Error response:", errorText);
        throw new Error(`Failed to create profile: ${response.status}`);
      }

      const result = await response.json();
      console.log("Profile created:", result);

      Alert.alert("Success", "Admin account created successfully!");
      router.replace("/(auth)/login");
    } catch (error: any) {
      console.error("Full error:", error);
      Alert.alert("Error", error.message || "Failed to create admin account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
      <Text
        style={{
          fontSize: 24,
          fontWeight: "bold",
          marginBottom: 20,
          textAlign: "center",
        }}
      >
        Create First Admin Account
      </Text>

      <TextInput
        placeholder="Full Name"
        value={fullName}
        onChangeText={setFullName}
        style={{
          borderWidth: 1,
          padding: 10,
          marginBottom: 10,
          borderRadius: 5,
        }}
      />

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        style={{
          borderWidth: 1,
          padding: 10,
          marginBottom: 10,
          borderRadius: 5,
        }}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{
          borderWidth: 1,
          padding: 10,
          marginBottom: 20,
          borderRadius: 5,
        }}
      />

      <Button
        title={loading ? "Creating Admin..." : "Create Admin Account"}
        onPress={handleAdminSignup}
        disabled={loading}
      />
    </View>
  );
}
