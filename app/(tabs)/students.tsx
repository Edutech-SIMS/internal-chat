import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  RefreshControl,
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

export default function UsersScreen() {
  const { hasRole, profile } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({
    full_name: "",
    email: "",
    role: "parent",
  });

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

  const handleAddUser = async () => {
    if (!newUser.full_name.trim() || !newUser.email.trim()) {
      Alert.alert("Error", "Full name and email are required");
      return;
    }

    if (!profile?.school_id) {
      Alert.alert("Error", "Missing school information");
      return;
    }

    try {
      // First, check if user already exists
      const { data: existingUser, error: fetchError } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", newUser.email)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        throw fetchError;
      }

      let userId;
      if (existingUser) {
        // User already exists
        userId = existingUser.id;
      } else {
        // Create new user in auth
        const { data: authData, error: authError } =
          await supabase.auth.admin.createUser({
            email: newUser.email,
            password: "TempPass123!", // In a real app, this would be a temporary password
            email_confirm: true,
          });

        if (authError) throw authError;

        // Create profile
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .insert({
            user_id: authData.user.id,
            full_name: newUser.full_name,
            email: newUser.email,
            school_id: profile.school_id,
          })
          .select()
          .single();

        if (profileError) throw profileError;

        userId = profileData.id;
      }

      // Assign role
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: userId,
        role: newUser.role,
        school_id: profile.school_id,
      });

      if (roleError) throw roleError;

      // Refresh the list
      await loadUsers();

      // Close modal and reset form
      setShowAddModal(false);
      setNewUser({
        full_name: "",
        email: "",
        role: "parent",
      });

      Alert.alert("Success", "User added successfully");
    } catch (error) {
      console.error("Error adding user:", error);
      Alert.alert("Error", "Failed to add user");
    }
  };

  const handleExport = () => {
    Alert.alert(
      "Export Users",
      `This would export ${users.length} users to a CSV file`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Export",
          onPress: () => {
            Alert.alert("Success", "Users data exported successfully");
          },
        },
      ]
    );
  };

  const handleEditUser = (userId: string, userName: string) => {
    Alert.alert("Edit User", `This would edit user: ${userName}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Edit",
        onPress: () => {
          Alert.alert("Edit User", "User edit form would be here");
        },
      },
    ]);
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    Alert.alert(
      "Delete User",
      `Are you sure you want to delete user "${userName}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Note: In a real implementation, you'd want to be more careful about deleting users
              // This is a simplified version for demonstration
              const { error } = await supabase
                .from("profiles")
                .delete()
                .eq("id", userId);

              if (error) throw error;

              // Refresh the list
              await loadUsers();
              Alert.alert("Success", "User deleted successfully");
            } catch (error) {
              console.error("Error deleting user:", error);
              Alert.alert("Error", "Failed to delete user");
            }
          },
        },
      ]
    );
  };

  const renderUserItem = (user: any) => {
    const roles =
      user.user_roles?.map((role: any) => role.role).join(", ") || "No roles";

    return (
      <View key={user.id} style={styles.userCard}>
        <View style={styles.userHeader}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={24} color="#007AFF" />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user.full_name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
          </View>
        </View>
        <View style={styles.userRoles}>
          <Text style={styles.rolesLabel}>Roles:</Text>
          <Text style={styles.rolesText}>{roles}</Text>
        </View>
        <View style={styles.userActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleEditUser(user.id, user.full_name)}
          >
            <Text style={styles.actionButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => handleDeleteUser(user.id, user.full_name)}
          >
            <Text style={styles.actionButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="people" size={32} color="#fff" />
            </View>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.subtitle}>
              Access restricted to administrators
            </Text>
          </View>
          <View style={styles.content}>
            <View style={styles.card}>
              <View style={styles.placeholderContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={60}
                  color="#007AFF"
                />
                <Text style={styles.placeholderText}>
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="people" size={32} color="#fff" />
          </View>
          <Text style={styles.title}>User Management</Text>
          <Text style={styles.subtitle}>Manage users and their roles</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{users.length}</Text>
              <Text style={styles.statLabel}>Total Users</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {
                  users.filter((u) =>
                    u.user_roles?.some((r: any) => r.role === "teacher")
                  ).length
                }
              </Text>
              <Text style={styles.statLabel}>Teachers</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {
                  users.filter((u) =>
                    u.user_roles?.some((r: any) => r.role === "parent")
                  ).length
                }
              </Text>
              <Text style={styles.statLabel}>Parents</Text>
            </View>
          </View>

          <View style={styles.actionsBar}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="person-add-outline" size={20} color="#fff" />
              <Text style={styles.buttonText}>Add User</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleExport}
            >
              <Ionicons name="download-outline" size={20} color="#007AFF" />
              <Text style={styles.secondaryButtonText}>Export</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.placeholderContainer}>
              <Text style={styles.placeholderText}>Loading users...</Text>
            </View>
          ) : users.length > 0 ? (
            users.map(renderUserItem)
          ) : (
            <View style={styles.card}>
              <View style={styles.placeholderContainer}>
                <Ionicons name="people-outline" size={60} color="#007AFF" />
                <Text style={styles.placeholderText}>No users found</Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => setShowAddModal(true)}
                >
                  <Text style={styles.buttonText}>Add Your First User</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add User Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showAddModal}
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New User</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Full Name"
              value={newUser.full_name}
              onChangeText={(text) =>
                setNewUser({ ...newUser, full_name: text })
              }
            />

            <TextInput
              style={styles.input}
              placeholder="Email Address"
              value={newUser.email}
              onChangeText={(text) => setNewUser({ ...newUser, email: text })}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.roleSelector}>
              <Text style={styles.roleLabel}>Role:</Text>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  newUser.role === "parent" && styles.selectedRole,
                ]}
                onPress={() => setNewUser({ ...newUser, role: "parent" })}
              >
                <Text
                  style={[
                    styles.roleText,
                    newUser.role === "parent" && styles.selectedRoleText,
                  ]}
                >
                  Parent
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  newUser.role === "teacher" && styles.selectedRole,
                ]}
                onPress={() => setNewUser({ ...newUser, role: "teacher" })}
              >
                <Text
                  style={[
                    styles.roleText,
                    newUser.role === "teacher" && styles.selectedRoleText,
                  ]}
                >
                  Teacher
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  newUser.role === "admin" && styles.selectedRole,
                ]}
                onPress={() => setNewUser({ ...newUser, role: "admin" })}
              >
                <Text
                  style={[
                    styles.roleText,
                    newUser.role === "admin" && styles.selectedRoleText,
                  ]}
                >
                  Admin
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleAddUser}
              >
                <Text style={styles.createButtonText}>Add User</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
