import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedText as Text } from "../../components/ThemedText";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

export default function SettingsScreen() {
  const { user, profile, loading, refreshProfile, signOut, school, session } =
    useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  console.log("SettingsScreen rendered, isDarkMode:", isDarkMode);

  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const router = useRouter();

  // keep displayName input in sync with profile
  useEffect(() => {
    if (profile?.full_name) {
      setNewDisplayName(profile.full_name);
    } else {
      setNewDisplayName("");
    }
  }, [profile]);

  useEffect(() => {
    console.log("Settings screen - isDarkMode updated:", isDarkMode);
  }, [isDarkMode]);

  // Update display name (profiles only)
  const updateDisplayName = async () => {
    if (!user || !newDisplayName.trim() || !profile?.school_id) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: newDisplayName.trim() })
        .eq("user_id", user.id)
        .eq("school_id", profile.school_id);

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

      const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: newPassword }),
      });

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

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshProfile();
    setRefreshing(false);
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
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.centerContainer}>
          <View style={styles.spinner} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading settings...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <View
            style={[
              styles.avatarContainer,
              { backgroundColor: colors.primary },
            ]}
          >
            <Ionicons
              name="person-circle"
              size={60}
              color={isDarkMode ? "#ccc" : "#fff"}
            />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
          <Text style={[styles.subtitle, { color: colors.text }]}>
            {profile?.full_name || user?.email}
          </Text>
        </View>

        {/* Appearance Settings */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons
              name="color-palette-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Appearance
            </Text>
          </View>

          <View
            style={[
              styles.settingItem,
              { borderBottomColor: colors.separator },
            ]}
          >
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              Dark Mode
            </Text>
            <Switch
              value={isDarkMode}
              onValueChange={toggleDarkMode}
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={isDarkMode ? "#fffbe5ff" : "#f4f3f4"}
              style={{ transform: [{ scale: 1.2 }] }}
            />
          </View>
        </View>

        {/* Account Information */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Account Information
            </Text>
          </View>

          <View
            style={[styles.infoItem, { borderBottomColor: colors.separator }]}
          >
            <Text style={[styles.infoLabel, { color: colors.text }]}>
              Email
            </Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {user?.email}
            </Text>
          </View>

          <View
            style={[styles.infoItem, { borderBottomColor: colors.separator }]}
          >
            <Text style={[styles.infoLabel, { color: colors.text }]}>
              Member Since
            </Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "N/A"}
            </Text>
          </View>
        </View>

        {/* Update Display Name */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Display Name
            </Text>
          </View>
          <TextInput
            value={newDisplayName}
            onChangeText={setNewDisplayName}
            placeholder="Enter your display name"
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            editable={!updating}
            placeholderTextColor={colors.placeholderText}
          />
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.primary },
              updating && styles.buttonDisabled,
            ]}
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
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Change Password
            </Text>
          </View>

          <Text style={[styles.noteText, { color: colors.text }]}>
            Note: that changing this password would change your console
            password.
          </Text>

          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Current password"
            secureTextEntry
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            editable={!changingPassword}
            placeholderTextColor={colors.placeholderText}
          />

          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="New password"
            secureTextEntry
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            editable={!changingPassword}
            placeholderTextColor={colors.placeholderText}
          />

          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            secureTextEntry
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            editable={!changingPassword}
            placeholderTextColor={colors.placeholderText}
          />

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.primary },
              changingPassword && styles.buttonDisabled,
            ]}
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
          <Text style={[styles.footerText, { color: colors.text }]}>
            {new Date().getFullYear()} Mindsync Solutions v1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
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
  loadingText: { marginTop: 10, fontSize: 16 },
  header: { alignItems: "center", marginBottom: 30, paddingTop: 30 },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  title: { fontSize: 28, fontWeight: "bold", marginTop: 10 },
  subtitle: { fontSize: 16, marginTop: 5 },
  section: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 8,
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingLabel: { fontSize: 16, fontWeight: "500" },
  infoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: 16, fontWeight: "500" },
  infoValue: { fontSize: 16 },
  input: {
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  noteText: { fontSize: 14, marginBottom: 8 },
  buttonDisabled: { backgroundColor: "#b0b8c1" },
  logoutButton: { backgroundColor: "#dc3545" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  footer: { alignItems: "center", padding: 20 },
  footerText: { fontSize: 14 },
});
