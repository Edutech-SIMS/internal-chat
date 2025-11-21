import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

interface UserRole {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

interface User {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: UserRole[]; // Changed from role to roles array
  created_at: string;
}

interface Group {
  id: string;
  name: string | null;
  description: string | null;
  is_public: boolean;
  is_announcement: boolean;
  created_at: string;
  member_count: number;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isUsersModalVisible, setUsersModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const { isAdmin, schoolId } = useAuth();

  const [activeTab, setActiveTab] = useState<"users" | "settings">("users");

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error) throw error;

        const user = data.user;
        if (!user) {
          setAuthLoading(false);
          return;
        }

        const { data: rolesData, error: rolesError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (rolesError) throw rolesError;

        const isAdmin = rolesData.some((role) => role.role === "admin");
        if (isAdmin) {
          const loadData = async () => {
            setLoading(true);
            try {
              await Promise.all([fetchUsers(), fetchGroups()]);
            } catch (err: any) {
              console.error("Failed to load admin data:", err);
              setError(err.message || "Failed to load data");
            } finally {
              setLoading(false);
            }
          };
          loadData();
        }
      } catch (err: any) {
        console.error("Error checking admin status:", err);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAdminStatus();
  }, []);

  const fetchUsers = async () => {
    try {
      // First fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;

      // Then fetch all user roles for these users
      if (profiles && profiles.length > 0) {
        const userIds = profiles.map((profile) => profile.id);
        const { data: userRoles, error: rolesError } = await supabase
          .from("user_roles")
          .select("*")
          .in("user_id", userIds);

        if (rolesError) throw rolesError;

        // Group roles by user_id
        const rolesByUser: Record<string, UserRole[]> = {};
        if (userRoles) {
          userRoles.forEach((role) => {
            if (!rolesByUser[role.user_id]) {
              rolesByUser[role.user_id] = [];
            }
            rolesByUser[role.user_id].push(role);
          });
        }

        // Combine profiles with their roles
        const usersWithRoles = profiles.map((profile) => ({
          ...profile,
          roles: rolesByUser[profile.id] || [],
        }));

        setUsers(usersWithRoles);
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      console.error("Error fetching users:", err);
      setUsers([]);
      throw err;
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
        (groupsData || []).map(async (group) => {
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

      setGroups(groupsWithCounts || []);
    } catch (err: any) {
      console.error("Error fetching groups:", err);
      setGroups([]);
      throw err;
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
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (authLoading || loading) {
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
      {/* Header & Stats */}
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

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "users" && styles.activeTab]}
          onPress={() => setActiveTab("users")}
        >
          <Ionicons
            name="people"
            size={20}
            color={activeTab === "users" ? "#007AFF" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "users" && styles.activeTabText,
            ]}
          >
            User Management
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "settings" && styles.activeTab]}
          onPress={() => setActiveTab("settings")}
        >
          <Ionicons
            name="settings"
            size={20}
            color={activeTab === "settings" ? "#007AFF" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "settings" && styles.activeTabText,
            ]}
          >
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {activeTab === "users" ? (
          <>
            {/* View Users */}
            <View>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setUsersModalVisible(true)}
              >
                <Text style={{ color: "#007AFF", fontSize: 17 }}>
                  View All Users
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            {/* Settings Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>System Settings</Text>
              <Text style={styles.sectionDescription}>
                Additional administrative settings and configurations will be
                available here.
              </Text>
              <View style={styles.settingItem}>
                <Ionicons name="information-circle" size={24} color="#007AFF" />
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>User Management</Text>
                  <Text style={styles.settingDescription}>
                    View and manage all users in your organization
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.settingAction}
                  onPress={() => {
                    setActiveTab("users");
                  }}
                >
                  <Text style={styles.settingActionText}>Manage</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>
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
  sectionDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
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
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  settingContent: {
    flex: 1,
    marginLeft: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: "#6b7280",
  },
  settingAction: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  settingActionText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
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
