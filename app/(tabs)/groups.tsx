import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

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
  user_id: string;
  joined_at: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

// Define the raw data structure from Supabase that accounts for array issue
interface RawGroupMemberData {
  id: string;
  user_id: string;
  joined_at: string;
  profiles:
    | {
        full_name: string | null;
        email: string | null;
      }[]
    | {
        full_name: string | null;
        email: string | null;
      }
    | null;
}

interface User {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export default function GroupsScreen() {
  const { hasRole, profile, user } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [newGroup, setNewGroup] = useState({
    name: "",
    description: "",
    is_public: true,
    is_announcement: false,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = hasRole("admin") || hasRole("superadmin");

  useEffect(() => {
    if (isAdmin) {
      loadGroups();
    }
  }, [isAdmin]);

  const loadGroups = async () => {
    if (!profile?.school_id) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch groups with member counts
      const { data: groupsData, error: groupsError } = await supabase
        .from("groups")
        .select("*")
        .eq("school_id", profile.school_id)
        .order("created_at", { ascending: false });

      if (groupsError) throw groupsError;

      // Get member counts for each group
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
    } catch (error: any) {
      console.error("Error loading groups:", error);
      setError(error.message || "Failed to load groups");
      Alert.alert("Error", error.message || "Failed to load groups");
    } finally {
      setLoading(false);
    }
  };

  const loadGroupMembers = async (groupId: string) => {
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select(
          `
        id,
        user_id,
        joined_at,
        profiles (
          full_name,
          email
        )
      `
        )
        .eq("group_id", groupId);

      console.log("Group members data:", data);

      if (error) throw error;

      // Cast the data to the expected type with unknown first to avoid TS errors
      const rawData = data as unknown as RawGroupMemberData[] | null;

      const transformedData: GroupMember[] = (rawData || []).map((member) => {
        // Handle case where profiles might be an array (unexpected but possible)
        let profileData = null;
        if (member.profiles) {
          if (Array.isArray(member.profiles) && member.profiles.length > 0) {
            // If it's an array, take the first item
            profileData = {
              full_name: member.profiles[0].full_name || null,
              email: member.profiles[0].email || null,
            };
          } else if (!Array.isArray(member.profiles)) {
            // If it's an object, use it directly
            profileData = {
              full_name: member.profiles.full_name || null,
              email: member.profiles.email || null,
            };
          }
        }

        return {
          id: member.id,
          user_id: member.user_id,
          joined_at: member.joined_at,
          profiles: profileData,
        };
      });

      console.log("Transformed group members data:", transformedData);
      setGroupMembers(transformedData);
    } catch (error: any) {
      console.error("Error loading group members:", error);
      Alert.alert("Error", error.message || "Failed to load group members");
    }
  };

  const loadAvailableUsers = async (group: Group) => {
    try {
      // Fetch all users in the school
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email")
        .eq("school_id", profile?.school_id);

      if (profilesError) throw profilesError;

      // Fetch existing members of this group
      const { data: existingMembers, error: membersError } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", group.id);

      if (membersError) throw membersError;

      // Filter out users who are already members
      const existingMemberIds = existingMembers?.map((m) => m.user_id) || [];
      const available =
        profiles?.filter((user) => !existingMemberIds.includes(user.user_id)) ||
        [];

      setAvailableUsers(available);
    } catch (error: any) {
      console.error("Error loading available users:", error);
      Alert.alert("Error", error.message || "Failed to load available users");
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadGroups();
    setRefreshing(false);
  };

  const handleCreateGroup = async () => {
    if (!newGroup.name.trim()) {
      Alert.alert("Error", "Group name is required");
      return;
    }

    if (!profile?.school_id || !user?.id) {
      Alert.alert("Error", "Missing required information");
      return;
    }

    setCreateLoading(true);
    try {
      const { data: groupData, error: insertError } = await supabase
        .from("groups")
        .insert({
          name: newGroup.name.trim(),
          description: newGroup.description.trim(),
          is_public: newGroup.is_public,
          is_announcement: newGroup.is_announcement,
          school_id: profile.school_id,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Automatically add the creator as a member
      const { error: memberError } = await supabase
        .from("group_members")
        .insert({
          user_id: user.id,
          group_id: groupData.id,
        });

      if (memberError) throw memberError;

      // Refresh the list
      await loadGroups();

      // Close modal and reset form
      setShowCreateModal(false);
      setNewGroup({
        name: "",
        description: "",
        is_public: true,
        is_announcement: false,
      });

      Alert.alert("Success", "Group created successfully");
    } catch (error: any) {
      console.error("Error creating group:", error);
      Alert.alert("Error", error.message || "Failed to create group");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleViewMembers = async (group: Group) => {
    setSelectedGroup(group);
    await loadGroupMembers(group.id);
    // Update loadAvailableUsers call in the members modal to pass the group
    setShowMembersModal(true);
  };

  const handleAddMember = async (userId: string, userName: string) => {
    if (!selectedGroup) return;

    try {
      const { error } = await supabase.from("group_members").insert({
        group_id: selectedGroup.id,
        user_id: userId,
      });

      if (error) throw error;

      // Refresh members list
      await loadGroupMembers(selectedGroup.id);
      await loadAvailableUsers(selectedGroup);

      Alert.alert("Success", `Added ${userName} to the group`);
    } catch (error: any) {
      console.error("Error adding member:", error);
      Alert.alert("Error", error.message || "Failed to add member to group");
    }
  };

  const handleRemoveMember = async (memberId: string, userName: string) => {
    if (!selectedGroup) return;

    Alert.alert(
      "Remove Member",
      `Are you sure you want to remove ${userName} from this group?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase
                .from("group_members")
                .delete()
                .eq("id", memberId);

              if (error) throw error;

              // Refresh members list
              if (selectedGroup) {
                await loadGroupMembers(selectedGroup.id);
                await loadAvailableUsers(selectedGroup);
              }

              Alert.alert("Success", `Removed ${userName} from the group`);
            } catch (error: any) {
              console.error("Error removing member:", error);
              Alert.alert(
                "Error",
                error.message || "Failed to remove member from group"
              );
            }
          },
        },
      ]
    );
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    Alert.alert(
      "Delete Group",
      `Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`,
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

              // Refresh the list
              await loadGroups();
              Alert.alert("Success", "Group deleted successfully");
              setShowMembersModal(false);
            } catch (error: any) {
              console.error("Error deleting group:", error);
              Alert.alert("Error", error.message || "Failed to delete group");
            }
          },
        },
      ]
    );
  };

  const renderGroupItem = (group: Group) => {
    return (
      <View key={group.id} style={[styles.groupCard, { backgroundColor: colors.card }]}>
        <View style={styles.groupHeader}>
          <View style={[styles.groupIcon, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons
              name={
                group.is_announcement ? "megaphone-outline" : "people-outline"
              }
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={styles.groupInfo}>
            <Text style={[styles.groupName, { color: colors.text }]}>{group.name}</Text>
            <Text style={[styles.groupDescription, { color: colors.placeholderText }]} numberOfLines={1}>
              {group.description || "No description"}
            </Text>
          </View>
        </View>

        <View style={styles.groupDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="person-outline" size={16} color="#666" />
            <Text style={styles.detailText}>{group.member_count} members</Text>
          </View>
          <View style={styles.detailItem}>
            {group.is_public ? (
              <Ionicons name="globe-outline" size={16} color="#28a745" />
            ) : (
              <Ionicons name="lock-closed-outline" size={16} color="#ffc107" />
            )}
            <Text style={styles.detailText}>
              {group.is_public ? "Public" : "Private"}
            </Text>
          </View>
          {group.is_announcement && (
            <View style={styles.detailItem}>
              <Ionicons name="megaphone-outline" size={16} color="#dc3545" />
              <Text style={styles.detailText}>Announcement</Text>
            </View>
          )}
        </View>

        <View style={styles.groupActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleViewMembers(group)}
          >
            <Text style={styles.actionButtonText}>View Members</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.addButton]}
            onPress={async () => {
              setSelectedGroup(group);
              await loadAvailableUsers(group);
              setShowAddMemberModal(true);
            }}
          >
            <Text style={styles.actionButtonText}>Add Member</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderMemberItem = ({ item }: { item: GroupMember }) => (
    <View style={styles.memberItem}>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {item.profiles?.full_name || item.profiles?.email || "Unknown User"}
        </Text>
        <Text style={styles.memberEmail}>
          {item.profiles?.email && item.profiles?.full_name
            ? item.profiles.email
            : item.profiles?.full_name
            ? "No email"
            : ""}
        </Text>
      </View>
      <Text style={styles.joinedDate}>
        {new Date(item.joined_at).toLocaleDateString()}
      </Text>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={() =>
          handleRemoveMember(item.id, item.profiles?.full_name || "User")
        }
      >
        <Ionicons name="close" size={20} color="#dc3545" />
      </TouchableOpacity>
    </View>
  );

  const renderAvailableUserItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userItem}
      onPress={async () => {
        await handleAddMember(item.user_id, item.full_name || "User");
        setShowAddMemberModal(false); // Close the modal after adding
      }}
    >
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.full_name}</Text>
        <Text style={styles.userEmail}>{item.email}</Text>
      </View>
      <Ionicons name="add" size={24} color="#007AFF" />
    </TouchableOpacity>
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.container}>
          <View style={[styles.header, { backgroundColor: colors.primary }]}>
            <View style={styles.iconContainer}>
              <Ionicons name="git-branch" size={32} color="#fff" />
            </View>
            <Text style={styles.title}>Group Management</Text>
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
            <Ionicons name="git-branch" size={32} color="#fff" />
          </View>
          <Text style={styles.title}>Group Management</Text>
          <Text style={styles.subtitle}>Manage groups and memberships</Text>
        </View>

        <View style={styles.content}>
          <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{groups.length}</Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Total Groups</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {groups.filter((g) => g.is_public).length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Public</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {groups.filter((g) => g.is_announcement).length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.placeholderText }]}>Announcement</Text>
            </View>
          </View>

          <View style={styles.actionsBar}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setShowCreateModal(true)}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.buttonText}>Create Group</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.card}>
              <View style={styles.errorContainer}>
                <Ionicons name="warning" size={40} color="#d32f2f" />
                <Text style={styles.errorText}>Error loading data</Text>
                <Text style={styles.errorDetail}>{error}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    setError(null);
                    loadGroups();
                  }}
                >
                  <Text style={styles.buttonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : loading ? (
            <View style={styles.placeholderContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.placeholderText}>Loading groups...</Text>
            </View>
          ) : groups.length > 0 ? (
            groups.map(renderGroupItem)
          ) : (
            <View style={styles.card}>
              <View style={styles.placeholderContainer}>
                <Ionicons name="git-branch-outline" size={60} color="#007AFF" />
                <Text style={styles.placeholderText}>No groups found</Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => setShowCreateModal(true)}
                >
                  <Text style={styles.buttonText}>Create Your First Group</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Create Group Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Group Name"
              value={newGroup.name}
              onChangeText={(text) => setNewGroup({ ...newGroup, name: text })}
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Description (optional)"
              value={newGroup.description}
              onChangeText={(text) =>
                setNewGroup({ ...newGroup, description: text })
              }
              multiline
              numberOfLines={3}
            />

            <View style={styles.checkboxContainer}>
              <TouchableOpacity
                style={styles.checkbox}
                onPress={() =>
                  setNewGroup({ ...newGroup, is_public: !newGroup.is_public })
                }
              >
                <Ionicons
                  name={newGroup.is_public ? "checkbox" : "square-outline"}
                  size={20}
                  color="#007AFF"
                />
                <Text style={styles.checkboxLabel}>Public Group</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkbox}
                onPress={() =>
                  setNewGroup({
                    ...newGroup,
                    is_announcement: !newGroup.is_announcement,
                  })
                }
              >
                <Ionicons
                  name={
                    newGroup.is_announcement ? "checkbox" : "square-outline"
                  }
                  size={20}
                  color="#007AFF"
                />
                <Text style={styles.checkboxLabel}>Announcement Group</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleCreateGroup}
                disabled={createLoading}
              >
                {createLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.createButtonText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Group Members Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showMembersModal}
        onRequestClose={() => setShowMembersModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { height: "90%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedGroup?.name} Members
              </Text>
              <TouchableOpacity onPress={() => setShowMembersModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.membersHeader}>
              <Text style={styles.membersCount}>
                {groupMembers.length} member
                {groupMembers.length !== 1 ? "s" : ""}
              </Text>
            </View>

            <FlatList
              data={groupMembers}
              keyExtractor={(item) => item.id}
              renderItem={renderMemberItem}
              style={styles.membersList}
              ListEmptyComponent={
                <View style={styles.emptyMembers}>
                  <Ionicons name="people-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyMembersText}>
                    No members in this group
                  </Text>
                </View>
              }
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButton]}
                onPress={() =>
                  selectedGroup &&
                  handleDeleteGroup(
                    selectedGroup.id,
                    selectedGroup.name || "Group"
                  )
                }
              >
                <Text style={styles.deleteButtonText}>Delete Group</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Member Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showAddMemberModal}
        onRequestClose={() => setShowAddMemberModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { height: "80%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Member to Group</Text>
              <TouchableOpacity onPress={() => setShowAddMemberModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={availableUsers}
              keyExtractor={(item) => item.id}
              renderItem={renderAvailableUserItem}
              style={styles.usersList}
              ListEmptyComponent={
                <View style={styles.emptyUsers}>
                  <Text style={styles.emptyUsersText}>
                    No available users to add
                  </Text>
                </View>
              }
            />
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
  },
  buttonText: {
    color: "white",
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
  groupCard: {
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
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  groupIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#e3f2fd",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  groupDescription: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  groupDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 15,
    marginBottom: 5,
  },
  detailText: {
    fontSize: 12,
    color: "#666",
    marginLeft: 5,
  },
  groupActions: {
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
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  checkboxContainer: {
    marginBottom: 20,
  },
  checkbox: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  checkboxLabel: {
    fontSize: 16,
    color: "#333",
    marginLeft: 10,
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
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
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
  membersHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  membersCount: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  addButton: {
    backgroundColor: "#007AFF",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  addButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 5,
  },
  membersList: {
    flex: 1,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  memberEmail: {
    fontSize: 14,
    color: "#666",
  },
  joinedDate: {
    fontSize: 12,
    color: "#999",
    marginRight: 10,
  },
  removeButton: {
    padding: 5,
  },
  userItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  userEmail: {
    fontSize: 14,
    color: "#666",
  },
  usersList: {
    flex: 1,
    marginTop: 10,
  },
  emptyMembers: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyMembersText: {
    fontSize: 16,
    color: "#999",
    marginTop: 10,
  },
  emptyUsers: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
  },
  emptyUsersText: {
    fontSize: 16,
    color: "#999",
  },
  errorContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#d32f2f",
    marginTop: 15,
    textAlign: "center",
  },
  errorDetail: {
    fontSize: 14,
    color: "#666",
    marginTop: 5,
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  deleteButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
