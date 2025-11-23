import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

export default function UsersScreen() {
  const { hasRole, profile, school } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = hasRole("admin") || hasRole("superadmin");

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  const loadUsers = async () => {
    if (!profile?.school_id) return;

    try {
      setLoading(true);

      // Fetch users with their roles
      const { data, error } = await supabase
        .from("profiles")
        .select(
          `
          id,
          user_id,
          full_name,
          email,
          user_roles (
            role
          )
        `
        )
        .eq("school_id", profile.school_id)
        .order("full_name");

      if (error) throw error;

      setUsers(data || []);
    } catch (error) {
      console.error("Error loading users:", error);
      Alert.alert("Error", "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  };

  const renderUserItem = (user: any) => {
    const roles =
      user.user_roles?.map((role: any) => role.role).join(", ") || "No roles";

    return (
      <View key={user.id} style={[styles.userCard, { backgroundColor: colors.card }]}>
        <View style={styles.userHeader}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="person" size={24} color={colors.primary} />
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user.full_name}</Text>
            <Text style={[styles.userEmail, { color: colors.placeholderText }]}>{user.email}</Text>
          </View>
        </View>
        <View style={[styles.userRoles, { borderBottomColor: colors.border }]}>
          <Text style={[styles.rolesLabel, { color: colors.placeholderText }]}>Roles:</Text>
          <Text style={[styles.rolesText, { color: colors.text }]}>{roles}</Text>
        </View>
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.container}>
          <View style={[styles.header, { backgroundColor: colors.primary }]}>
            <View style={styles.iconContainer}>
              <Ionicons name="people" size={32} color="#fff" />
            </View>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.subtitle}>
              Access restricted to administrators
            </Text>
          </View>
          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.placeholderContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={60}
                  color={colors.primary}
                />
                <Text style={[styles.placeholderText, { color: colors.placeholderText }]}>
                  You don{`'`}t have permission to access this feature
                </Text>
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <View style={styles.iconContainer}>
            <Ionicons name="people" size={32} color="#fff" />
          </View>
          <Text style={styles.title}>Users in {school?.name}</Text>
          <Text style={styles.subtitle}>View users and their roles</Text>
        </View>

        <View style={styles.content}>
          <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{users.length}</Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Total Users</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{
                  users.filter((u) =>
                    u.user_roles?.some((r: any) => r.role === "teacher")
                  ).length
                }</Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Teachers</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{
                  users.filter((u) =>
                    u.user_roles?.some((r: any) => r.role === "parent")
                  ).length
                }</Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Parents</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.placeholderContainer}>
              <Text style={[styles.placeholderText, { color: colors.placeholderText }]}>Loading users...</Text>
            </View>
          ) : users.length > 0 ? (
            users.map(renderUserItem)
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.placeholderContainer}>
                <Ionicons name="people-outline" size={60} color={colors.primary} />
                <Text style={[styles.placeholderText, { color: colors.placeholderText }]}>No users found</Text>
                <Text style={[styles.buttonText, { color: colors.placeholderText }]}>No users yet.</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  container: {
    flex: 1,
  },
  header: {
    backgroundColor: "#007AFF",
    padding: 20,
    paddingTop: 40,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#0056b3",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginTop: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#e0e0e0",
    marginTop: 5,
    textAlign: "center",
    marginBottom: 20,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  statsCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#007AFF",
  },
  statLabel: {
    fontSize: 14,
    color: "#666",
    marginTop: 5,
  },
  actionsBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  secondaryButton: {
    backgroundColor: "white",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#007AFF",
    flex: 1,
    marginLeft: 10,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  secondaryButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  card: {
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
  placeholderContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  placeholderText: {
    fontSize: 16,
    color: "#999",
    marginTop: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  userCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#e3f2fd",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  userEmail: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  userRoles: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rolesLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
    marginRight: 10,
  },
  rolesText: {
    fontSize: 14,
    color: "#333",
  },
  userActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  actionButton: {
    backgroundColor: "#007AFF",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginLeft: 10,
  },
  deleteButton: {
    backgroundColor: "#dc3545",
  },
  actionButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    width: "90%",
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  roleSelector: {
    marginBottom: 20,
  },
  roleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  roleOption: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 10,
  },
  selectedRole: {
    borderColor: "#007AFF",
    backgroundColor: "#e3f2fd",
  },
  roleText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  selectedRoleText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  modalButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flex: 1,
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  createButton: {
    backgroundColor: "#007AFF",
  },
  cancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  createButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
