import { useRouter } from "expo-router";
import React from "react";
import { Button, Text, TouchableOpacity, View } from "react-native";

export default function Welcome() {
  const router = useRouter();

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
        Welcome to Chat App
      </Text>

      <Text style={{ marginBottom: 30, textAlign: "center" }}>
        Please login to continue. If you&apos;re setting up for the first time,
        create an admin account.
      </Text>

      <Button title="Login" onPress={() => router.push("/(auth)/login")} />

      <TouchableOpacity
        style={{
          marginTop: 20,
          padding: 15,
          backgroundColor: "#f0f0f0",
          borderRadius: 5,
        }}
        onPress={() => router.push("/(auth)/admin-signup")}
      >
        <Text style={{ textAlign: "center", color: "blue" }}>
          First Time Setup - Create Admin Account
        </Text>
      </TouchableOpacity>
    </View>
  );
}
