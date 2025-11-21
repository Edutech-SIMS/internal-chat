import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

export default function ProfileScreen() {
  const { user, profile, loading, refreshProfile, signOut, session } =
    useAuth();

  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const router = useRouter();

  // keep displayName input in sync with profile
  useEffect(() => {
    if (profile?.full_name) {
      setNewDisplayName(profile.full_name);
    } else {
      setNewDisplayName("");
    }
  }, [profile]);

  // Update display name (profiles only)
  const updateDisplayName = async () => {
    if (!user || !newDisplayName.trim() || !profile?.school_id) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: newDisplayName.trim() })
        .eq("id", user.id)
        .eq("school_id", profile.school_id); // <- scoped to school

      if (error) throw error;

      await refreshProfile();
      Alert.alert("Success", "Display name updated successfully!");
    } catch (error: any) {
      console.error("Error updating display name:", error);
      Alert.alert("Error", error.message || "Failed to update display name");
    } finally {
      setUpdating(false);
    }
  };

  const changePassword = async () => {
    if (!user || !newPassword || !profile?.school_id) return;

    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "New passwords do not match");
      return;
    }

    setChangingPassword(true);

    try {
      // Optional: confirm the user is in the same school (scoping check)
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;
      if (profileData.school_id !== profile.school_id) {
        throw new Error("Unauthorized: school mismatch");
      }

      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("No access token available");

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/user`,
        {
          method: "PUT",
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: newPassword }),
        }
      );

      const data = await res.json();

      if (!res.ok)
        throw new Error(data?.message || "Failed to update password");

      // Success — clear fields
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      Alert.alert("Success", "Password updated. You will be logged out.", [
        {
          text: "OK",
          onPress: async () => {
            try {
              await signOut();
            } finally {
              router.replace("/(auth)/login");
            }
          },
        },
      ]);
    } catch (err: any) {
      console.error("Password update error:", err);
      Alert.alert("Error", err.message || "Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <View style={styles.spinner} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person-circle" size={60} color="#fff" />
          </View>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>
            {profile?.full_name || user?.email}
          </Text>
        </View>

        {/* Account Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color="#007AFF"
            />
            <Text style={styles.sectionTitle}>Account Information</Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email}</Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Member Since</Text>
            <Text style={styles.infoValue}>
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "N/A"}
            </Text>
          </View>
        </View>

        {/* Update Display Name */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={20} color="#007AFF" />
            <Text style={styles.sectionTitle}>Display Name</Text>
          </View>
          <TextInput
            value={newDisplayName}
            onChangeText={setNewDisplayName}
            placeholder="Enter your display name"
            style={styles.input}
            editable={!updating}
          />
          <TouchableOpacity
            style={[styles.button, updating && styles.buttonDisabled]}
            onPress={updateDisplayName}
            disabled={
              updating ||
              !newDisplayName.trim() ||
              newDisplayName === profile?.full_name
            }
          >
            {updating ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.buttonText}>Update Display Name</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Change Password */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="lock-closed-outline" size={20} color="#007AFF" />
            <Text style={styles.sectionTitle}>Change Password</Text>
          </View>

          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Current password"
            secureTextEntry
            style={styles.input}
            editable={!changingPassword}
          />

          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="New password"
            secureTextEntry
            style={styles.input}
            editable={!changingPassword}
          />

          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            secureTextEntry
            style={styles.input}
            editable={!changingPassword}
          />

          <TouchableOpacity
            style={[styles.button, changingPassword && styles.buttonDisabled]}
            onPress={changePassword}
            disabled={
              changingPassword ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
          >
            {changingPassword ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.buttonText}>Change Password</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.button, styles.logoutButton]}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Internal Chat App v1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f8f9fa" },
  container: { flex: 1, padding: 20 },
  scrollContent: { paddingBottom: 30 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "#007AFF",
    borderTopColor: "transparent",
    marginBottom: 16,
  },
  loadingText: { marginTop: 10, color: "#666", fontSize: 16 },
  header: { alignItems: "center", marginBottom: 30, paddingTop: 20 },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#333", marginTop: 10 },
  subtitle: { fontSize: 16, color: "#666", marginTop: 5 },
  section: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
  },
  infoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  infoLabel: { fontSize: 16, color: "#666", fontWeight: "500" },
  infoValue: { fontSize: 16, color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fafafa",
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  buttonDisabled: { backgroundColor: "#b0b8c1" },
  logoutButton: { backgroundColor: "#dc3545" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  footer: { alignItems: "center", padding: 20 },
  footerText: { color: "#666", fontSize: 14 },
});
