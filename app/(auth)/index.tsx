import { Redirect } from "expo-router";

export default function AuthIndex() {
  // Redirect to general login page
  return <Redirect href="/(auth)/login" />;
}
