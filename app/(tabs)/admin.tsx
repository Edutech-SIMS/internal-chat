import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  is_announcement: boolean;
  created_at: string;
  member_count: number;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  useState(false);
  const { isAdmin, loading: authLoading, schoolId } = useAuth();

  // User creation state
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");

  // Modal states
  const [isUsersModalVisible, setUsersModalVisible] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) {
      const loadData = async () => {
        try {
          await Promise.all([fetchUsers(), fetchGroups()]);
        } catch (err: any) {
          console.error("Failed to load admin data:", err);
          setError(err.message || "Failed to load data");
        }
      };
      loadData();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("school_id", schoolId) // <-- only users from this school
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching users:", error);
      throw error;
    } else {
      setUsers(data || []);
    }
  };

  const fetchGroups = async () => {
    try {
      const { data: groupsData, error: groupsError } = await supabase
        .from("groups")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });

      if (groupsError) throw groupsError;

      const groupsWithCounts = await Promise.all(
        groupsData.map(async (group) => {
          const { count, error: countError } = await supabase
            .from("group_members")
            .select("*", { count: "exact", head: true })
            .eq("group_id", group.id);

          return {
            ...group,
            member_count: countError ? 0 : count || 0,
          };
        })
      );

      setGroups(groupsWithCounts);
    } catch (error) {
      console.error("Error fetching groups:", error);
      setGroups([]);
      throw error;
    } finally {
      setLoading(false);
    }
  };

const createUser = async () => {
  if (!newUserEmail || !newUserPassword || !newUserName) {
    Alert.alert("Error", "Please fill all fields");
    return;
  }

  if (!schoolId) {
    Alert.alert("Error", "Cannot create user: school context missing");
    return;
  }

  setLoading(true);

  try {
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email: newUserEmail,
        password: newUserPassword,
        full_name: newUserName,
        school_id: schoolId,
      },
    });

    if (error) {
      throw new Error(error.message || "Failed to create user");
    }

    if (data.error) {
      throw new Error(data.error);
    }

    Alert.alert("Success", "User created successfully!");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserName("");
    fetchUsers();
  } catch (error: any) {
    console.error("Creation error:", error);
    Alert.alert("Error", error.message || "Failed to create user");
  } finally {
    setLoading(false);
  }
};

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning" size={40} color="#d32f2f" />
        <Text style={styles.errorText}>Error loading data</Text>
        <Text style={styles.errorDetail}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setError(null);
            fetchUsers();
            fetchGroups();
          }}
          accessibilityLabel="Retry loading data"
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{users.length}</Text>
            <Text style={styles.statLabel}>Users</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{groups.length}</Text>
            <Text style={styles.statLabel}>Groups</Text>
          </View>
        </View>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, styles.activeTab]}
          accessibilityLabel="Users tab"
        >
          <Ionicons name="people" size={20} color="#007AFF" />
          <Text style={[styles.tabText, styles.activeTabText]}>
            User Management
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Create New User</Text>
            <TextInput
              placeholder="Full Name"
              value={newUserName}
              onChangeText={setNewUserName}
              style={styles.input}
              accessibilityLabel="Full name input"
            />
            <TextInput
              placeholder="Email"
              value={newUserEmail}
              onChangeText={setNewUserEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              accessibilityLabel="Email input"
            />
            <TextInput
              placeholder="Password"
              value={newUserPassword}
              onChangeText={setNewUserPassword}
              secureTextEntry
              style={styles.input}
              accessibilityLabel="Password input"
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={createUser}
              disabled={loading}
              accessibilityLabel="Create user button"
            >
              <Text style={styles.buttonText}>
                {loading ? "Creating..." : "Create User"}
              </Text>
            </TouchableOpacity>
          </View>

          <View>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => setUsersModalVisible(true)}
              accessibilityLabel="View all users"
            >
              <Text style={{ color: "#007AFF", fontSize: 17 }}>
                View All Users
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Users Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isUsersModalVisible}
        onRequestClose={() => setUsersModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>All Users</Text>
              <TouchableOpacity
                onPress={() => setUsersModalVisible(false)}
                accessibilityLabel="Close users modal"
              >
                <Ionicons name="close" size={24} color="#1a1c1e" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              {users.length === 0 ? (
                <Text style={styles.emptyText}>No users available</Text>
              ) : (
                users.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardContent}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {item.full_name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardTitle}>{item.full_name}</Text>
                        <Text style={styles.cardSubtitle}>{item.email}</Text>
                        <View
                          style={[
                            styles.badge,
                            item.role === "admin" && styles.adminBadge,
                          ]}
                        >
                          <Text style={styles.badgeText}>{item.role}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f6f8",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#fff",
    margin: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#d32f2f",
    marginTop: 12,
    marginBottom: 8,
    textAlign: "center",
  },
  errorDetail: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#555",
  },
  header: {
    backgroundColor: "#fff",
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e2e5",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1c1e",
    marginBottom: 20,
  },
  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#f8f9fa",
    padding: 12,
    borderRadius: 8,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "600",
    color: "#007AFF",
  },
  statLabel: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e2e5",
    paddingHorizontal: 16,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: "#007AFF",
  },
  tabText: {
    fontSize: 17,
    color: "#666",
    fontWeight: "600",
  },
  activeTabText: {
    color: "#007AFF",
    fontWeight: "700",
  },
  content: {
    flex: 1,
    padding: 24,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 20,
    color: "#1a1c1e",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d0d4d8",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
    height: 48,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
    paddingTop: 12,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 8,
  },
  buttonDisabled: {
    backgroundColor: "#b0b8c1",
  },
  secondaryButton: {
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#d0d4d8",
  },
  cancelButton: {
    flex: 1,
    marginRight: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButtonText: {
    color: "#1a1c1e",
  },
  buttonLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLoadingText: {
    marginLeft: 8,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1a1c1e",
  },
  switch: {
    width: 56,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#d0d4d8",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  switchActive: {
    backgroundColor: "#007AFF",
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  switchThumbActive: {
    transform: [{ translateX: 24 }],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "90%",
    maxHeight: "80%",
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e2e5",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1c1e",
  },
  modalContent: {
    padding: 16,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 16,
    textAlign: "center",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#d0d4d8",
    borderRadius: 8,
    backgroundColor: "#fff",
    marginBottom: 16,
    overflow: "hidden", // Ensure rounded corners are respected
  },
  picker: {
    height: Platform.OS === "ios" ? 150 : 48, // Taller on iOS for native wheel
    fontSize: 16,
    color: "#1a1c1e",
  },
  selectLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    color: "#1a1c1e",
  },
  modalButtonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  groupAvatar: {
    backgroundColor: "#2e7d32",
  },
  avatarText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1c1e",
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 8,
    lineHeight: 20,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    backgroundColor: "#e0e2e5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadge: {
    backgroundColor: "#d32f2f",
  },
  publicBadge: {
    backgroundColor: "#0288d1",
  },
  announcementBadge: {
    backgroundColor: "#f57c00",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#fff",
  },
  scrollBox: {
    maxHeight: 150,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#d0d4d8",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  option: {
    padding: 12,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  optionText: {
    fontSize: 14,
    color: "#1a1c1e",
  },
  optionSelected: {
    backgroundColor: "#007bff22",
  },
  permissionsModal: {
    width: "95%",
    maxHeight: "85%",
  },
  permissionHelpText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    lineHeight: 20,
    textAlign: "center",
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f3f4",
  },
  memberInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1c1e",
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 14,
    color: "#666",
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 12,
    color: "#888",
    textTransform: "capitalize",
  },
  permissionToggle: {
    backgroundColor: "#dc3545",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    minWidth: 80,
    alignItems: "center",
  },
  permissionEnabled: {
    backgroundColor: "#28a745",
  },
  permissionToggleText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  tertiaryButton: {
    backgroundColor: "#6c757d",
    marginTop: 8,
  },
  tertiaryButtonText: {
    color: "#fff",
  },
  groupSelector: {
    marginBottom: 20,
    maxHeight: 50,
  },
  groupOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f8f9fa",
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  groupOptionSelected: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  groupOptionText: {
    color: "#495057",
    fontSize: 14,
    fontWeight: "500",
  },
  groupOptionTextSelected: {
    color: "white",
  },
});
