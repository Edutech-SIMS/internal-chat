import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: "Login" }} />
      <Stack.Screen
        name="admin-signup"
        options={{ title: "Create Admin Account" }}
      />
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="school-splash" options={{ headerShown: false }} />
    </Stack>
  );
}
