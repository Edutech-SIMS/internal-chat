import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

interface GroupMember {
  id: string;
  email: string;
  full_name: string;
  user_id: string;
  roles: UserRole[];
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const { isAdmin, schoolId } = useAuth();

  // Group management state
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupIsPublic, setNewGroupIsPublic] = useState(true);
  const [newGroupIsAnnouncement, setNewGroupIsAnnouncement] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const [activeTab, setActiveTab] = useState<"users" | "groups" | "settings">(
    "users"
  );
  const [isCreateGroupModalVisible, setCreateGroupModalVisible] =
    useState(false);
  const [isGroupDetailsModalVisible, setGroupDetailsModalVisible] =
    useState(false);

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

  const fetchGroupMembers = async (groupId: string) => {
    try {
      // First get the group members
      const { data: memberData, error: memberError } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);

      if (memberError) throw memberError;

      // Extract user IDs
      const userIds = memberData?.map((member) => member.user_id) || [];

      if (userIds.length === 0) {
        setGroupMembers([]);
        return;
      }

      // Fetch profiles for these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, full_name, user_id")
        .in("user_id", userIds);

      if (profilesError) throw profilesError;

      // Fetch roles for these users
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);

      if (rolesError) throw rolesError;

      // Group roles by user_id
      const rolesByUser: Record<string, UserRole[]> = {};
      userRoles?.forEach((role) => {
        if (!rolesByUser[role.user_id]) {
          rolesByUser[role.user_id] = [];
        }
        // Create proper UserRole objects
        rolesByUser[role.user_id].push({
          id: `${role.user_id}-${role.role}`,
          user_id: role.user_id,
          role: role.role,
          created_at: new Date().toISOString(),
        });
      });

      // Combine profiles with their roles
      const membersWithRoles: GroupMember[] =
        profiles?.map((profile) => ({
          ...profile,
          roles: rolesByUser[profile.user_id] || [],
        })) || [];

      setGroupMembers(membersWithRoles);
    } catch (error) {
      console.error("Error fetching group members:", error);
      Alert.alert("Error", "Failed to load group members");
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert("Error", "Group name is required");
      return;
    }

    setCreateLoading(true);
    try {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !authUser) throw new Error("No authenticated user");

      const { data: groupData, error: insertError } = await supabase
        .from("groups")
        .insert({
          name: newGroupName,
          description: newGroupDescription,
          is_public: newGroupIsPublic,
          is_announcement: newGroupIsAnnouncement,
          created_by: authUser.id,
          school_id: schoolId,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { error: memberError } = await supabase
        .from("group_members")
        .insert({ user_id: authUser.id, group_id: groupData.id });
      if (memberError) throw memberError;

      Alert.alert("Success", "Group created successfully!");
      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupIsPublic(true);
      setNewGroupIsAnnouncement(false);
      setCreateGroupModalVisible(false);
      fetchGroups();
    } catch (error: any) {
      console.error("Group creation error:", error);
      Alert.alert("Error", error.message || "Failed to create group");
    } finally {
      setCreateLoading(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    Alert.alert(
      "Delete Group",
      "Are you sure you want to delete this group? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete group members first
              const { error: membersError } = await supabase
                .from("group_members")
                .delete()
                .eq("group_id", groupId);

              if (membersError) throw membersError;

              // Delete messages
              const { error: messagesError } = await supabase
                .from("messages")
                .delete()
                .eq("group_id", groupId);

              if (messagesError) throw messagesError;

              // Delete the group itself
              const { error: groupError } = await supabase
                .from("groups")
                .delete()
                .eq("id", groupId);

              if (groupError) throw groupError;

              Alert.alert("Success", "Group deleted successfully!");
              fetchGroups();
              setGroupDetailsModalVisible(false);
            } catch (error: any) {
              console.error("Group deletion error:", error);
              Alert.alert("Error", error.message || "Failed to delete group");
            }
          },
        },
      ]
    );
  };

  const viewGroupDetails = async (group: Group) => {
    setSelectedGroup(group);
    setGroupDetailsModalVisible(true);
    await fetchGroupMembers(group.id);
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

      {/* Improved Tab Navigation */}
      <View style={styles.tabNavigation}>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === "users" && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab("users")}
          >
            <Ionicons
              name="people"
              size={20}
              color={activeTab === "users" ? "#007AFF" : "#666"}
            />
            <Text
              style={[
                styles.tabItemText,
                activeTab === "users" && styles.activeTabItemText,
              ]}
            >
              Users
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === "groups" && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab("groups")}
          >
            <Ionicons
              name="chatbubbles"
              size={20}
              color={activeTab === "groups" ? "#007AFF" : "#666"}
            />
            <Text
              style={[
                styles.tabItemText,
                activeTab === "groups" && styles.activeTabItemText,
              ]}
            >
              Groups
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabItem,
              activeTab === "settings" && styles.activeTabItem,
            ]}
            onPress={() => setActiveTab("settings")}
          >
            <Ionicons
              name="settings"
              size={20}
              color={activeTab === "settings" ? "#007AFF" : "#666"}
            />
            <Text
              style={[
                styles.tabItemText,
                activeTab === "settings" && styles.activeTabItemText,
              ]}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>

        {/* Active Tab Indicator */}
        <View
          style={[
            styles.tabIndicator,
            {
              left: `${
                activeTab === "users"
                  ? 0
                  : activeTab === "groups"
                  ? 33.33
                  : 66.66
              }%`,
              width: "33.33%",
            },
          ]}
        />
      </View>

      <ScrollView style={styles.content}>
        {activeTab === "users" ? (
          <>
            {/* User Management Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Users</Text>
              <Text style={styles.sectionDescription}>
                All users in your organization
              </Text>

              {users.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={60} color="#ccc" />
                  <Text style={styles.emptyText}>No users found</Text>
                  <Text style={styles.emptySubtext}>
                    Users will appear here once they join your organization
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={users}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.card}>
                      <View style={styles.cardContent}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {item.full_name
                              ? item.full_name.charAt(0).toUpperCase()
                              : "?"}
                          </Text>
                        </View>
                        <View style={styles.cardInfo}>
                          <Text style={styles.cardTitle}>
                            {item.full_name || "Unnamed User"}
                          </Text>
                          <Text style={styles.cardSubtitle} numberOfLines={1}>
                            {item.email || "No email provided"}
                          </Text>
                          <View style={styles.badges}>
                            {item.roles &&
                              item.roles.map((role) => (
                                <View
                                  key={role.id}
                                  style={[
                                    styles.badge,
                                    role.role === "admin"
                                      ? styles.adminBadge
                                      : styles.badge,
                                  ]}
                                >
                                  <Text style={styles.badgeText}>
                                    {role.role}
                                  </Text>
                                </View>
                              ))}
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>
          </>
        ) : activeTab === "groups" ? (
          <>
            {/* Group Management */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Manage Groups</Text>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setCreateGroupModalVisible(true)}
                >
                  <Ionicons name="add" size={20} color="white" />
                  <Text style={styles.addButtonText}>Create Group</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionDescription}>
                Create and manage groups for your organization
              </Text>

              {groups.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubbles-outline" size={60} color="#ccc" />
                  <Text style={styles.emptyText}>No groups created yet</Text>
                  <Text style={styles.emptySubtext}>
                    Create your first group to get started
                  </Text>
                  <TouchableOpacity
                    style={[styles.button, styles.createEmptyButton]}
                    onPress={() => setCreateGroupModalVisible(true)}
                  >
                    <Ionicons name="add" size={20} color="white" />
                    <Text style={styles.buttonText}>
                      Create Your First Group
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <FlatList
                  data={groups}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.card}>
                      <View style={styles.cardContent}>
                        <View style={styles.avatar}>
                          <Ionicons name="people" size={24} color="white" />
                        </View>
                        <View style={styles.cardInfo}>
                          <Text style={styles.cardTitle}>{item.name}</Text>
                          <Text style={styles.cardSubtitle} numberOfLines={1}>
                            {item.description || "No description"}
                          </Text>
                          <View style={styles.badges}>
                            {item.is_announcement && (
                              <View
                                style={[styles.badge, styles.announcementBadge]}
                              >
                                <Text style={styles.badgeText}>
                                  Announcement
                                </Text>
                              </View>
                            )}
                            {item.is_public ? (
                              <View style={[styles.badge, styles.publicBadge]}>
                                <Text style={styles.badgeText}>Public</Text>
                              </View>
                            ) : (
                              <View style={[styles.badge, styles.badge]}>
                                <Text style={styles.badgeText}>Private</Text>
                              </View>
                            )}
                            <View style={[styles.badge, styles.badge]}>
                              <Text style={styles.badgeText}>
                                {item.member_count} member
                                {item.member_count !== 1 ? "s" : ""}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.cardAction}
                          onPress={() => viewGroupDetails(item)}
                        >
                          <Text style={styles.cardActionText}>Manage</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>
          </>
        ) : (
          <>
            {/* Settings Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>System Settings</Text>
              <Text style={styles.sectionDescription}>
                Configure your organization&apos;s settings and preferences
              </Text>

              <View style={styles.settingCategory}>
                <Text style={styles.settingCategoryTitle}>Organization</Text>

                <View style={styles.settingItem}>
                  <Ionicons name="business" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>
                      Organization Profile
                    </Text>
                    <Text style={styles.settingDescription}>
                      Update your organization&apos;s name, logo, and
                      information
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.settingAction}
                    onPress={() => {}}
                  >
                    <Text style={styles.settingActionText}>Edit</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.settingItem}>
                  <Ionicons name="shield" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Security Settings</Text>
                    <Text style={styles.settingDescription}>
                      Configure authentication and security policies
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.settingAction}
                    onPress={() => {}}
                  >
                    <Text style={styles.settingActionText}>Manage</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.settingCategory}>
                <Text style={styles.settingCategoryTitle}>User Management</Text>

                <View style={styles.settingItem}>
                  <Ionicons name="people" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>User Roles</Text>
                    <Text style={styles.settingDescription}>
                      Define roles and permissions for users
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

                <View style={styles.settingItem}>
                  <Ionicons name="chatbubbles" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Group Settings</Text>
                    <Text style={styles.settingDescription}>
                      Configure group creation and management policies
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.settingAction}
                    onPress={() => {
                      setActiveTab("groups");
                    }}
                  >
                    <Text style={styles.settingActionText}>Manage</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.settingCategory}>
                <Text style={styles.settingCategoryTitle}>Notifications</Text>

                <View style={styles.settingItem}>
                  <Ionicons name="mail" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Email Notifications</Text>
                    <Text style={styles.settingDescription}>
                      Configure email notification preferences
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.settingAction}
                    onPress={() => {}}
                  >
                    <Text style={styles.settingActionText}>Configure</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.settingItem}>
                  <Ionicons name="notifications" size={24} color="#007AFF" />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Push Notifications</Text>
                    <Text style={styles.settingDescription}>
                      Configure push notification settings
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.settingAction}
                    onPress={() => {}}
                  >
                    <Text style={styles.settingActionText}>Configure</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Create Group Modal */}
      <Modal
        visible={isCreateGroupModalVisible}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TouchableOpacity
                onPress={() => setCreateGroupModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <TextInput
                placeholder="Group Name"
                value={newGroupName}
                onChangeText={setNewGroupName}
                style={styles.input}
                placeholderTextColor="#888"
              />
              <TextInput
                placeholder="Description (Optional)"
                value={newGroupDescription}
                onChangeText={setNewGroupDescription}
                style={[styles.input, styles.textArea]}
                placeholderTextColor="#888"
                multiline
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Public Group</Text>
                <TouchableOpacity
                  style={[
                    styles.switch,
                    newGroupIsPublic && styles.switchActive,
                  ]}
                  onPress={() => {
                    setNewGroupIsPublic(!newGroupIsPublic);
                    // If making public, ensure it's not announcement-only
                    if (!newGroupIsPublic && newGroupIsAnnouncement) {
                      setNewGroupIsAnnouncement(false);
                    }
                  }}
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
                  onPress={() => {
                    setNewGroupIsAnnouncement(!newGroupIsAnnouncement);
                    // If making announcement-only, ensure it's not public
                    if (!newGroupIsAnnouncement && newGroupIsPublic) {
                      setNewGroupIsPublic(false);
                    }
                  }}
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
                style={[styles.button, createLoading && styles.buttonDisabled]}
                onPress={createGroup}
                disabled={createLoading}
              >
                <Text style={styles.buttonText}>
                  {createLoading ? "Creating..." : "Create Group"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Group Details Modal */}
      <Modal visible={isGroupDetailsModalVisible} animationType="slide">
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setGroupDetailsModalVisible(false)}
            >
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {selectedGroup?.name || "Group Details"}
            </Text>
            <TouchableOpacity
              onPress={() => deleteGroup(selectedGroup?.id || "")}
            >
              <Ionicons name="trash" size={24} color="#dc3545" />
            </TouchableOpacity>
          </View>

          {selectedGroup && (
            <ScrollView style={styles.modalContent}>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Group Information</Text>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Name</Text>
                  <Text style={styles.infoValue}>{selectedGroup.name}</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Description</Text>
                  <Text style={styles.infoValue}>
                    {selectedGroup.description || "No description"}
                  </Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Type</Text>
                  <Text style={styles.infoValue}>
                    {selectedGroup.is_announcement ? "Announcement" : "Chat"}{" "}
                    Group
                  </Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Visibility</Text>
                  <Text style={styles.infoValue}>
                    {selectedGroup.is_public ? "Public" : "Private"}
                  </Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Members</Text>
                  <Text style={styles.infoValue}>
                    {selectedGroup.member_count} member
                    {selectedGroup.member_count !== 1 ? "s" : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Members</Text>
                {groupMembers.length === 0 ? (
                  <Text style={styles.emptyText}>No members in this group</Text>
                ) : (
                  groupMembers.map((member) => (
                    <View key={member.id} style={styles.memberItem}>
                      <View style={styles.memberInfo}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {member.full_name
                              ? member.full_name.charAt(0).toUpperCase()
                              : "?"}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.memberName}>
                            {member.full_name || "Unknown User"}
                          </Text>
                          <Text style={styles.memberEmail}>
                            {member.email || "No email"}
                          </Text>
                          <Text style={styles.memberRole}>
                            {member.roles && member.roles.length > 0
                              ? member.roles[0].role
                              : "user"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
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
  sectionDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  emptySubtext: {
    fontSize: 12,
    color: "#888",
    marginBottom: 24,
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
  settingCategory: {
    marginBottom: 24,
  },
  settingCategoryTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1c1e",
    marginBottom: 16,
    marginTop: 8,
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
  addButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  createEmptyButton: {
    marginTop: 20,
  },
  infoItem: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  infoValue: {
    fontSize: 16,
    color: "#1a1c1e",
  },
  memberItem: {
    marginBottom: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardAction: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cardActionText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  tabNavigation: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e2e5",
  },
  tabBar: {
    flexDirection: "row",
    height: 50,
  },
  tabItem: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  activeTabItem: {
    // No additional styling needed, active state is indicated by the indicator
  },
  tabItemText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "500",
  },
  activeTabItemText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    height: 3,
    backgroundColor: "#007AFF",
    // Note: CSS transitions are not supported in React Native
  },
});
