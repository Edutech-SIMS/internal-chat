import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { EventRegister } from "react-native-event-listeners";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

interface Group {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  is_announcement: boolean;
  created_at: string;
  is_member: boolean;
  member_count: number;
}

interface GroupMember {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export default function GroupsScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const { user, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    fetchGroups();
  }, []);

  useEffect(() => {
    // Add event listener
    const subscription = EventRegister.addEventListener("refreshGroups", () => {
      fetchGroups(); // quietly refresh
    });

    // Cleanup properly
    return () => {
      if (typeof subscription === "string") {
        EventRegister.removeEventListener(subscription);
      }
    };
  }, [user?.id]);

  const fetchGroups = async () => {
    try {
      let groupsData;

      if (isAdmin) {
        // Admin can see ALL groups
        const { data: allGroups, error: groupsError } = await supabase
          .from("groups")
          .select("*")
          .order("created_at", { ascending: false });

        if (groupsError) throw groupsError;
        groupsData = allGroups;
      } else {
        // Regular users: Only get groups they're members of
        const { data: userGroups, error: groupsError } = await supabase
          .from("group_members")
          .select(
            `
          groups (
            id,
            name,
            description,
            is_public,
            is_announcement,
            created_at
          )
        `
          )
          .eq("user_id", user?.id)
          .order("created_at", { foreignTable: "groups", ascending: false });

        if (groupsError) throw groupsError;

        // Extract groups from the nested response
        groupsData =
          userGroups?.map((item) => item.groups).filter(Boolean) || [];
      }

      // Get user's memberships to show join/leave status (for admin view)
      const { data: userMemberships, error: membersError } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user?.id);

      if (membersError) throw membersError;

      const userMemberGroupIds = new Set(
        userMemberships?.map((m) => m.group_id) || []
      );

      // Get member counts for each group
      const groupsWithDetails = await Promise.all(
        (groupsData || []).map(async (group) => {
          const { count, error: countError } = await supabase
            .from("group_members")
            .select("*", { count: "exact", head: true })
            .eq("group_id", group.id);

          return {
            ...group,
            is_member: userMemberGroupIds.has(group.id),
            member_count: countError ? 0 : count || 0,
          };
        })
      );

      setGroups(groupsWithDetails);
    } catch (error) {
      console.error("Error fetching groups:", error);
      Alert.alert("Error", "Failed to load groups");
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMembers = async (groupId: string) => {
    try {
      // Use service role for admin operations to avoid RLS issues
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/group_members?select=profiles(id,email,full_name,role)&group_id=eq.${groupId}`,
        {
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const members = data
        .map((item: any) => item.profiles)
        .filter(Boolean) as GroupMember[];
      setGroupMembers(members);
    } catch (error) {
      console.error("Error fetching group members:", error);

      // Fallback: try regular query (may fail due to RLS)
      try {
        const { data, error: supabaseError } = await supabase
          .from("group_members")
          .select("profiles (id, email, full_name, role)")
          .eq("group_id", groupId);

        if (supabaseError) throw supabaseError;

        const members = data
          ?.map((item) => item.profiles)
          .filter(Boolean) as unknown as GroupMember[];
        setGroupMembers(members);
      } catch (fallbackError) {
        console.error("Fallback also failed:", fallbackError);
        Alert.alert("Error", "Failed to load group members");
      }
    }
  };

  const joinGroup = async (groupId: string) => {
    setJoining(groupId);

    try {
      const { error } = await supabase.from("group_members").insert([
        {
          user_id: user?.id,
          group_id: groupId,
        },
      ]);

      if (error) throw error;

      Alert.alert("Success", "Joined group successfully!");
      fetchGroups();
    } catch (error: any) {
      console.error("Error joining group:", error);
      Alert.alert("Error", error.message || "Failed to join group");
    } finally {
      setJoining(null);
    }
  };

  const leaveGroup = async (groupId: string) => {
    try {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("user_id", user?.id)
        .eq("group_id", groupId);

      if (error) throw error;

      Alert.alert("Success", "Left group successfully!");
      fetchGroups();
    } catch (error: any) {
      console.error("Error leaving group:", error);
      Alert.alert("Error", error.message || "Failed to leave group");
    }
  };

  const viewGroupDetails = async (group: Group) => {
    if (!isAdmin) {
      // For regular users, navigate to chat
      router.push(`/chat/${group.id}?name=${encodeURIComponent(group.name)}`);
      return;
    }

    // For admins, show group details modal
    setSelectedGroup(group);
    await fetchGroupMembers(group.id);
    setShowGroupModal(true);
  };

  const removeUserFromGroup = async (userId: string) => {
    if (!selectedGroup) return;

    try {
      // Use service role for admin operations
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/group_members?user_id=eq.${userId}&group_id=eq.${selectedGroup.id}`,
        {
          method: "DELETE",
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env
              .EXPO_PUBLIC_SUPABASE_SERVICE_KEY!}`,
            Prefer: "return=minimal",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      Alert.alert("Success", "User removed from group");
      fetchGroupMembers(selectedGroup.id);
      fetchGroups();
    } catch (error: any) {
      console.error("Error removing user:", error);

      // Fallback: try regular delete
      try {
        const { error: supabaseError } = await supabase
          .from("group_members")
          .delete()
          .eq("user_id", userId)
          .eq("group_id", selectedGroup.id);

        if (supabaseError) throw supabaseError;

        Alert.alert("Success", "User removed from group");
        fetchGroupMembers(selectedGroup.id);
        fetchGroups();
      } catch (fallbackError) {
        console.error("Fallback also failed:", fallbackError);
        Alert.alert("Error", error.message || "Failed to remove user");
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10 }}>Loading groups...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>
          {isAdmin ? "All Groups" : "Available Groups"}
        </Text>
        <Text style={styles.subtitle}>
          {isAdmin
            ? "Manage all groups and members"
            : "Join groups to start chatting with your team"}
        </Text>

        {groups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={60} color="#ccc" />
            <Text style={styles.emptyText}>No groups available yet</Text>
            <Text style={styles.emptySubtext}>
              {isAdmin
                ? "Create groups in the Admin dashboard"
                : "Groups will appear here once they are created"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.groupCard}
                onPress={() => viewGroupDetails(item)}
              >
                <View style={styles.groupHeader}>
                  <Text style={styles.groupName}>{item.name}</Text>
                  {item.is_announcement && (
                    <View style={styles.announcementBadge}>
                      <Ionicons name="megaphone" size={12} color="white" />
                      <Text style={styles.badgeText}>Announcements</Text>
                    </View>
                  )}
                  {!item.is_public && (
                    <View style={styles.privateBadge}>
                      <Ionicons name="lock-closed" size={12} color="white" />
                      <Text style={styles.badgeText}>Private</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.groupDescription}>{item.description}</Text>

                <View style={styles.groupFooter}>
                  <Text style={styles.memberCount}>
                    {item.member_count} member
                    {item.member_count !== 1 ? "s" : ""}
                  </Text>

                  {isAdmin ? (
                    <View style={styles.adminBadge}>
                      <Ionicons
                        name="shield-checkmark"
                        size={14}
                        color="#007AFF"
                      />
                      <Text style={styles.adminBadgeText}>Manage</Text>
                    </View>
                  ) : item.is_member ? (
                    <TouchableOpacity
                      style={styles.leaveButton}
                      onPress={() => leaveGroup(item.id)}
                    >
                      <Text style={styles.leaveButtonText}>Leave</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.joinButton}
                      onPress={() => joinGroup(item.id)}
                      disabled={joining === item.id}
                    >
                      {joining === item.id ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text style={styles.joinButtonText}>Join</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      {/* Group Details Modal for Admins */}
      <Modal
        visible={showGroupModal}
        animationType="slide"
        onRequestClose={() => setShowGroupModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setShowGroupModal(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Group Details</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedGroup && (
            <View style={styles.modalContent}>
              <View style={styles.groupInfo}>
                <Text style={styles.groupInfoName}>{selectedGroup.name}</Text>
                <Text style={styles.groupInfoDescription}>
                  {selectedGroup.description}
                </Text>
                <View style={styles.groupMeta}>
                  <Text style={styles.groupMetaText}>
                    {selectedGroup.is_public ? "Public" : "Private"} Group
                  </Text>
                  <Text style={styles.groupMetaText}>
                    {selectedGroup.is_announcement
                      ? "Announcements Only"
                      : "Chat Group"}
                  </Text>
                  <Text style={styles.groupMetaText}>
                    {groupMembers.length} Members
                  </Text>
                </View>
              </View>

              <Text style={styles.membersTitle}>Group Members</Text>

              {groupMembers.length === 0 ? (
                <Text style={styles.noMembersText}>
                  No members in this group
                </Text>
              ) : (
                <FlatList
                  data={groupMembers}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.memberItem}>
                      <View style={styles.memberInfo}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {item.full_name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.memberName}>
                            {item.full_name}
                          </Text>
                          <Text style={styles.memberEmail}>{item.email}</Text>
                          <Text style={styles.memberRole}>{item.role}</Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => removeUserFromGroup(item.id)}
                        style={styles.removeButton}
                      >
                        <Ionicons
                          name="person-remove"
                          size={20}
                          color="#dc3545"
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              )}
            </View>
          )}
        </SafeAreaView>
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
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  listContent: {
    paddingBottom: 20,
  },
  groupCard: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
  },
  groupName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  announcementBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  privateBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6c757d",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  badgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  groupDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    lineHeight: 20,
  },
  groupFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  memberCount: {
    fontSize: 14,
    color: "#666",
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e3f2fd",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  adminBadgeText: {
    color: "#007AFF",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  joinButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  joinButtonText: {
    color: "white",
    fontWeight: "600",
  },
  leaveButton: {
    backgroundColor: "#dc3545",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  leaveButtonText: {
    color: "white",
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "white",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  groupInfo: {
    marginBottom: 24,
  },
  groupInfoName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  groupInfoDescription: {
    fontSize: 16,
    color: "#666",
    marginBottom: 12,
    lineHeight: 22,
  },
  groupMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  groupMetaText: {
    backgroundColor: "#e9ecef",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    fontSize: 12,
    color: "#495057",
  },
  membersTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  noMembersText: {
    textAlign: "center",
    color: "#666",
    fontSize: 16,
    marginTop: 40,
  },
  memberItem: {
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
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
  removeButton: {
    padding: 8,
  },
});
