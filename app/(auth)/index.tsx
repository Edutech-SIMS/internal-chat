import { Redirect } from "expo-router";
import { useAuth } from "../../contexts/AuthContext";

export default function AuthIndex() {
  const { user, loading } = useAuth();

  if (loading) return null; // wait for auth state

  return <Redirect href={user ? "/school-splash" : "/(auth)/login"} />;
}
