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
  const [activeTab, setActiveTab] = useState<"users" | "groups">("users");
  const [loading, setLoading] = useState(false);
  const { isAdmin, loading: authLoading } = useAuth();

  // User creation state
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");

  // Group creation state
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupIsPublic, setNewGroupIsPublic] = useState(true);
  const [newGroupIsAnnouncement, setNewGroupIsAnnouncement] = useState(false);

  // Modal states
  const [isUsersModalVisible, setUsersModalVisible] = useState(false);
  const [isGroupsModalVisible, setGroupsModalVisible] = useState(false);
  const [isAssignModalVisible, setAssignModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(users[0]?.id ?? "");
  const [selectedGroup, setSelectedGroup] = useState(groups[0]?.id ?? "");

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
        .select("id, name, description, is_public, is_announcement, created_at")
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

    setLoading(true);

    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
          },
          body: JSON.stringify({
            email: newUserEmail,
            password: newUserPassword,
            email_confirm: true,
            user_metadata: {
              full_name: newUserName,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Auth creation failed: ${response.status} - ${errorText}`
        );
      }

      const authData = await response.json();

      const profileResponse = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/profiles`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: authData.id,
            email: newUserEmail,
            full_name: newUserName,
            role: "user",
          }),
        }
      );

      if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        throw new Error(
          `Profile creation failed: ${profileResponse.status} - ${errorText}`
        );
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

  const createGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert("Error", "Group name is required");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/groups`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            name: newGroupName,
            description: newGroupDescription,
            is_public: newGroupIsPublic,
            is_announcement: newGroupIsAnnouncement,
            created_by: user.id,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create group: ${response.status} - ${errorText}`
        );
      }

      const groupData = await response.json();
      const newGroup = groupData[0];

      const memberResponse = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/group_members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: user.id,
            group_id: newGroup.id,
          }),
        }
      );

      if (!memberResponse.ok) {
        console.warn(
          "Failed to auto-add admin to group, but group was created"
        );
      }

      Alert.alert(
        "Success",
        "Group created successfully! You have been automatically added to the group."
      );
      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupIsPublic(true);
      setNewGroupIsAnnouncement(false);
      fetchGroups();
    } catch (error: any) {
      console.error("Group creation error:", error);
      Alert.alert("Error", error.message || "Failed to create group");
    } finally {
      setLoading(false);
    }
  };

  const addUserToGroup = async () => {
    if (!selectedUser || !selectedGroup) {
      Alert.alert("Error", "Please select both a user and a group");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/group_members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: selectedUser,
            group_id: selectedGroup,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to add user to group: ${response.status} - ${errorText}`
        );
      }

      Alert.alert("Success", "User added to group successfully!");
      setSelectedUser("");
      setSelectedGroup("");
      setAssignModalVisible(false);
      fetchGroups();
    } catch (error: any) {
      console.error("Add to group error:", error);
      Alert.alert("Error", error.message || "Failed to add user to group");
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
          style={[styles.tab, activeTab === "users" && styles.activeTab]}
          onPress={() => setActiveTab("users")}
          accessibilityLabel="Users tab"
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
            Users
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "groups" && styles.activeTab]}
          onPress={() => setActiveTab("groups")}
          accessibilityLabel="Groups tab"
        >
          <Ionicons
            name="layers"
            size={20}
            color={activeTab === "groups" ? "#007AFF" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "groups" && styles.activeTabText,
            ]}
          >
            Groups
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {activeTab === "users" ? (
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
        ) : (
          <View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create New Group</Text>
              <TextInput
                placeholder="Group Name"
                value={newGroupName}
                onChangeText={setNewGroupName}
                style={styles.input}
                accessibilityLabel="Group name input"
              />
              <TextInput
                placeholder="Description (Optional)"
                value={newGroupDescription}
                onChangeText={setNewGroupDescription}
                style={[styles.input, styles.textArea]}
                multiline
                numberOfLines={3}
                accessibilityLabel="Group description input"
              />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Public Group</Text>
                <TouchableOpacity
                  style={[
                    styles.switch,
                    newGroupIsPublic && styles.switchActive,
                  ]}
                  onPress={() => setNewGroupIsPublic(!newGroupIsPublic)}
                  accessibilityLabel={`Toggle public group ${
                    newGroupIsPublic ? "on" : "off"
                  }`}
                >
                  <View
                    style={[
                      styles.switchThumb,
                      newGroupIsPublic && styles.switchThumbActive,
                    ]}
                  />
                </TouchableOpacity>
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Announcement Group</Text>
                <TouchableOpacity
                  style={[
                    styles.switch,
                    newGroupIsAnnouncement && styles.switchActive,
                  ]}
                  onPress={() =>
                    setNewGroupIsAnnouncement(!newGroupIsAnnouncement)
                  }
                  accessibilityLabel={`Toggle announcement group ${
                    newGroupIsAnnouncement ? "on" : "off"
                  }`}
                >
                  <View
                    style={[
                      styles.switchThumb,
                      newGroupIsAnnouncement && styles.switchThumbActive,
                    ]}
                  />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={createGroup}
                disabled={loading}
                accessibilityLabel="Create group button"
              >
                <Text style={styles.buttonText}>
                  {loading ? "Creating..." : "Create Group"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => setAssignModalVisible(true)}
                accessibilityLabel="Assign user to group"
              >
                <Text style={styles.buttonText}>Assign User to Group</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setGroupsModalVisible(true)}
                accessibilityLabel="View all groups"
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                  View All Groups
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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

      {/* Groups Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isGroupsModalVisible}
        onRequestClose={() => setGroupsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>All Groups</Text>
              <TouchableOpacity
                onPress={() => setGroupsModalVisible(false)}
                accessibilityLabel="Close groups modal"
              >
                <Ionicons name="close" size={24} color="#1a1c1e" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              {groups.length === 0 ? (
                <Text style={styles.emptyText}>No groups available</Text>
              ) : (
                groups.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardContent}>
                      <View style={[styles.avatar, styles.groupAvatar]}>
                        <Ionicons name="people" size={20} color="white" />
                      </View>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardTitle}>{item.name}</Text>
                        <Text style={styles.cardSubtitle} numberOfLines={2}>
                          {item.description || "No description"}
                        </Text>
                        <View style={styles.badges}>
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>
                              {item.member_count} members
                            </Text>
                          </View>
                          {item.is_public && (
                            <View style={[styles.badge, styles.publicBadge]}>
                              <Text style={styles.badgeText}>Public</Text>
                            </View>
                          )}
                          {item.is_announcement && (
                            <View
                              style={[styles.badge, styles.announcementBadge]}
                            >
                              <Text style={styles.badgeText}>Announcement</Text>
                            </View>
                          )}
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

      {/* Assign User to Group Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isAssignModalVisible}
        onRequestClose={() => setAssignModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign User to Group</Text>
              <TouchableOpacity
                onPress={() => setAssignModalVisible(false)}
                accessibilityLabel="Close assign user modal"
              >
                <Ionicons name="close" size={24} color="#1a1c1e" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalContent}>
              {users.length === 0 || groups.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {users.length === 0 && groups.length === 0
                      ? "No users or groups available"
                      : users.length === 0
                      ? "No users available"
                      : "No groups available"}
                  </Text>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={() => setAssignModalVisible(false)}
                    accessibilityLabel="Close modal"
                  >
                    <Text
                      style={[styles.buttonText, styles.secondaryButtonText]}
                    >
                      Close
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* USERS */}
                  <Text style={styles.selectLabel}>Select User</Text>
                  <ScrollView
                    style={styles.scrollBox}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    {users.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={[
                          styles.option,
                          selectedUser === user.id && styles.optionSelected,
                        ]}
                        onPress={() => setSelectedUser(user.id)}
                      >
                        <Text style={styles.optionText}>
                          {user.full_name} ({user.email})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* GROUPS */}
                  <Text style={styles.selectLabel}>Select Group</Text>
                  <ScrollView
                    style={styles.scrollBox}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    {groups.map((group) => (
                      <TouchableOpacity
                        key={group.id}
                        style={[
                          styles.option,
                          selectedGroup === group.id && styles.optionSelected,
                        ]}
                        onPress={() => setSelectedGroup(group.id)}
                      >
                        <Text style={styles.optionText}>
                          {group.name} ({group.member_count} members)
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* ACTION BUTTONS */}
                  <View style={styles.modalButtonContainer}>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.secondaryButton,
                        styles.cancelButton,
                      ]}
                      onPress={() => {
                        setSelectedUser("");
                        setSelectedGroup("");
                        setAssignModalVisible(false);
                      }}
                      accessibilityLabel="Cancel assignment"
                    >
                      <Text
                        style={[styles.buttonText, styles.secondaryButtonText]}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        (!selectedUser || !selectedGroup || loading) &&
                          styles.buttonDisabled,
                      ]}
                      onPress={addUserToGroup}
                      disabled={!selectedUser || !selectedGroup || loading}
                      accessibilityLabel="Assign user to group button"
                    >
                      {loading ? (
                        <View style={styles.buttonLoadingContainer}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text
                            style={[
                              styles.buttonText,
                              styles.buttonLoadingText,
                            ]}
                          >
                            Assigning...
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.buttonText}>Assign to Group</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
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
});
