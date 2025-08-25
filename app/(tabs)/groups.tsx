import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import debounce from "lodash/debounce";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface GroupMemberResponse {
  profiles: GroupMember;
}

interface GroupMessagePermissionResponse {
  user_id: string;
  can_send_messages: boolean;
}

export default function GroupsScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [messagePermissions, setMessagePermissions] = useState<{
    [key: string]: boolean;
  }>({});
  const [permissionLoading, setPermissionLoading] = useState<string | null>(
    null
  );

  const { user, isAdmin, schoolId } = useAuth();
  const router = useRouter();

  // Group creation state
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupIsPublic, setNewGroupIsPublic] = useState(true);
  const [newGroupIsAnnouncement, setNewGroupIsAnnouncement] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // User assignment state - updated for multiple users
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedGroupForAssignment, setSelectedGroupForAssignment] =
    useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");

  // Modal state management
  const [modalState, setModalState] = useState<{
    type: "none" | "group" | "create" | "addUser" | "permissions";
    group: Group | null;
  }>({ type: "none", group: null });

  const openModal = useCallback(
    (type: typeof modalState.type, group: Group | null = null) => {
      setModalState({ type, group });
      if (type === "addUser") {
        const groupMemberIds = new Set(groupMembers.map((m) => m.id));
        const availableUsers = allUsers.filter(
          (user) => !groupMemberIds.has(user.id)
        );
        setFilteredUsers(availableUsers);
        setUserSearchQuery("");
        setSelectedUsers([]); // Reset selected users when opening modal
      }
    },
    [allUsers, groupMembers, modalState]
  );

  const closeModal = useCallback(() => {
    setModalState({ type: "none", group: null });
    setSelectedUsers([]);
    setSelectedGroupForAssignment("");
    setUserSearchQuery("");
    setFilteredUsers(allUsers);
    setGroupMembers([]);
    setMessagePermissions({});
    setPermissionLoading(null);
  }, [allUsers]);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      let groupsData;

      if (isAdmin) {
        const { data, error } = await supabase
          .from("groups")
          .select("*")
          .eq("school_id", schoolId) // <-- filter by school
          .order("created_at", { ascending: false });
        if (error) throw new Error(`Failed to fetch groups: ${error.message}`);
        groupsData = data || [];
      } else {
        const { data, error } = await supabase
          .from("group_members")
          .select("groups (*)")
          .eq("user_id", user?.id)
          .eq("groups.school_id", schoolId) // <-- filter by school
          .order("created_at", { foreignTable: "groups", ascending: false });
        if (error)
          throw new Error(`Failed to fetch user groups: ${error.message}`);
        groupsData = data?.map((item) => item.groups).filter(Boolean) || [];
      }

      const { data: userMemberships, error: membershipsError } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user?.id);
      if (membershipsError) throw membershipsError;

      const userMemberGroupIds = new Set(
        userMemberships?.map((m) => m.group_id) || []
      );

      const groupsWithDetails = await Promise.all(
        groupsData.map(async (group) => {
          const { count, error } = await supabase
            .from("group_members")
            .select("*", { count: "exact", head: true })
            .eq("group_id", group.id);
          if (error)
            throw new Error(`Failed to fetch member count: ${error.message}`);
          return {
            ...group,
            is_member: userMemberGroupIds.has(group.id),
            member_count: count || 0,
          };
        })
      );

      setGroups(groupsWithDetails);
    } catch (error) {
      console.error("Error fetching groups:", error);
      Alert.alert("Error", "Unable to load groups. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const debouncedFetchGroups = useCallback(debounce(fetchGroups, 300), [
    isAdmin,
    user?.id,
  ]);

  const fetchAllUsers = async () => {
    try {
     const { data, error } = await supabase
       .from("profiles")
       .select("*")
       .eq("school_id", schoolId) // <-- only users from this school
       .order("created_at", { ascending: false });

      if (error) throw new Error(`Failed to fetch users: ${error.message}`);
      setAllUsers(data || []);
      setFilteredUsers(data || []);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchGroupMembers = async (groupId: string) => {
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select("profiles(id,email,full_name,role)")
        .eq("group_id", groupId);
      if (error) throw new Error(`Failed to fetch members: ${error.message}`);
      const members = (data as unknown as GroupMemberResponse[])
        .map((item) => item.profiles)
        .filter(Boolean) as GroupMember[];
      setGroupMembers(members);
      await fetchMessagePermissions(groupId);
    } catch (error) {
      console.error("Error fetching group members:", error);
      Alert.alert("Error", "Failed to load group members");
    }
  };

  const fetchMessagePermissions = async (groupId: string) => {
    try {
      const { data, error } = await supabase
        .from("group_message_permissions")
        .select("user_id, can_send_messages")
        .eq("group_id", groupId);
      if (error)
        throw new Error(`Failed to fetch permissions: ${error.message}`);
      const permissionsMap: { [key: string]: boolean } = {};
      ((data as GroupMessagePermissionResponse[]) || []).forEach((perm) => {
        permissionsMap[perm.user_id] = perm.can_send_messages;
      });
      setMessagePermissions(permissionsMap);
    } catch (error) {
      console.error("Error fetching permissions:", error);
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
         school_id: schoolId, // <-- attach school
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
      closeModal();
      debouncedFetchGroups();
    } catch (error: any) {
      console.error("Group creation error:", error);
      Alert.alert("Error", error.message || "Failed to create group");
    } finally {
      setCreateLoading(false);
    }
  };

  // Updated to handle multiple users
  const addUsersToGroup = async () => {
    if (selectedUsers.length === 0) {
      Alert.alert("Error", "Please select at least one user");
      return;
    }

    const groupId = modalState.group?.id || selectedGroupForAssignment;
    if (!groupId) {
      Alert.alert("Error", "No group selected");
      return;
    }

    try {
      // Prepare batch insert
      const membersToAdd = selectedUsers.map((userId) => ({
        user_id: userId,
        group_id: groupId,
      }));

      const { error } = await supabase
        .from("group_members")
        .insert(membersToAdd);

      if (error) throw new Error(`Failed to add users: ${error.message}`);

      Alert.alert(
        "Success",
        `${selectedUsers.length} user(s) added to group successfully!`
      );
      setSelectedUsers([]);
      setUserSearchQuery("");
      setFilteredUsers(allUsers);
      closeModal();

      if (modalState.group) {
        await fetchGroupMembers(modalState.group.id);
      }
      debouncedFetchGroups();
    } catch (error: any) {
      console.error("Add users error:", error);
      Alert.alert("Error", error.message || "Failed to add users to group");
    }
  };

  // Add all available users to the group
  const addAllUsersToGroup = async () => {
    const groupId = modalState.group?.id || selectedGroupForAssignment;
    if (!groupId) {
      Alert.alert("Error", "No group selected");
      return;
    }

    if (filteredUsers.length === 0) {
      Alert.alert("Info", "No users available to add");
      return;
    }

    try {
      // Get all user IDs from filteredUsers
      const allUserIds = filteredUsers.map((user) => user.id);

      // Prepare batch insert
      const membersToAdd = allUserIds.map((userId) => ({
        user_id: userId,
        group_id: groupId,
      }));

      const { error } = await supabase
        .from("group_members")
        .insert(membersToAdd);

      if (error) throw new Error(`Failed to add users: ${error.message}`);

      Alert.alert(
        "Success",
        `${allUserIds.length} user(s) added to group successfully!`
      );
      setSelectedUsers([]);
      setUserSearchQuery("");
      setFilteredUsers([]);
      closeModal();

      if (modalState.group) {
        await fetchGroupMembers(modalState.group.id);
      }
      debouncedFetchGroups();
    } catch (error: any) {
      console.error("Add all users error:", error);
      Alert.alert("Error", error.message || "Failed to add users to group");
    }
  };

  const removeUserFromGroup = async (userId: string) => {
    if (!modalState.group) return;

    try {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("user_id", userId)
        .eq("group_id", modalState.group.id);
      if (error) throw new Error(`Failed to remove user: ${error.message}`);

      Alert.alert("Success", "User removed from group");
      await fetchGroupMembers(modalState.group.id);
      debouncedFetchGroups();
    } catch (error: any) {
      console.error("Remove user error:", error);
      Alert.alert("Error", error.message || "Failed to remove user");
    }
  };

  const updateMessagePermission = async (userId: string, canSend: boolean) => {
    if (!modalState.group) return;

    const loadingKey = `${modalState.group.id}-${userId}`;
    setPermissionLoading(loadingKey);

    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) throw new Error("No authenticated user");

      const { error } = await supabase.from("group_message_permissions").upsert(
        {
          group_id: modalState.group.id,
          user_id: userId,
          can_send_messages: canSend,
          granted_by: authUser.id,
        },
        { onConflict: "group_id,user_id" }
      );
      if (error)
        throw new Error(`Failed to update permission: ${error.message}`);

      setMessagePermissions((prev) => ({ ...prev, [userId]: canSend }));
      Alert.alert("Success", "Message permission updated!");
    } catch (error: any) {
      console.error("Permission update error:", error);
      Alert.alert("Error", error.message || "Failed to update permission");
    } finally {
      setPermissionLoading(null);
    }
  };

  const handleUserSearch = (query: string) => {
    setUserSearchQuery(query);
    const groupMemberIds = new Set(groupMembers.map((m) => m.id));
    const availableUsers = allUsers.filter(
      (user) => !groupMemberIds.has(user.id)
    );
    if (query.trim() === "") {
      setFilteredUsers(availableUsers);
    } else {
      const lowerQuery = query.toLowerCase();
      setFilteredUsers(
        availableUsers.filter(
          (user) =>
            user.full_name.toLowerCase().includes(lowerQuery) ||
            user.email.toLowerCase().includes(lowerQuery)
        )
      );
    }
  };

  // Toggle user selection for multiple users
  const toggleUserSelection = (userId: string) => {
    setSelectedUsers((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  // Select all users in the current filtered list
  const selectAllUsers = () => {
    const allFilteredUserIds = filteredUsers.map((user) => user.id);
    setSelectedUsers(allFilteredUserIds);
  };

  // Deselect all users
  const deselectAllUsers = () => {
    setSelectedUsers([]);
  };

  const viewGroupDetails = async (group: Group) => {
    if (!isAdmin) {
      router.push(`/chat/${group.id}?name=${encodeURIComponent(group.name)}`);
      return;
    }

    openModal("group", group);
    await fetchGroupMembers(group.id);
  };

  useEffect(() => {
    debouncedFetchGroups();
    if (isAdmin) {
      fetchAllUsers();
    }
    return () => debouncedFetchGroups.cancel();
  }, [debouncedFetchGroups, isAdmin]);

  useEffect(() => {
    const listener = EventRegister.addEventListener("refreshGroups", () => {
      debouncedFetchGroups();
    });

    return () => {
      EventRegister.removeEventListener(listener as string);
    };
  }, [debouncedFetchGroups, user?.id]);

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
        <View style={styles.header}>
          <Text style={styles.title}>
            {isAdmin ? "Group Management" : "Your Groups"}
          </Text>
          {isAdmin && (
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => openModal("create")}
            >
              <Ionicons name="add" size={20} color="white" />
              <Text style={styles.createButtonText}>Create Group</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.subtitle}>
          {isAdmin ? "Manage all groups and members" : "Your joined groups"}
        </Text>

        {groups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={60} color="#ccc" />
            <Text style={styles.emptyText}>No groups available yet</Text>
            <Text style={styles.emptySubtext}>
              {isAdmin
                ? "Create your first group to get started"
                : "No groups available"}
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
                  {!item.is_public ? (
                    <View style={styles.privateBadge}>
                      <Ionicons name="lock-closed" size={12} color="white" />
                      <Text style={styles.badgeText}>Private</Text>
                    </View>
                  ) : (
                    <View style={styles.publicBadge}>
                      <Ionicons name="globe-outline" size={12} color="white" />
                      <Text style={styles.badgeText}>Public</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.groupDescription}>{item.description}</Text>

                <View style={styles.groupFooter}>
                  <Text style={styles.memberCount}>
                    {item.member_count} member
                    {item.member_count !== 1 ? "s" : ""}
                  </Text>
                  {isAdmin && (
                    <View style={styles.adminBadge}>
                      <Ionicons
                        name="shield-checkmark"
                        size={14}
                        color="#007AFF"
                      />
                      <Text style={styles.adminBadgeText}>Manage</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContent}
            initialNumToRender={10}
            windowSize={5}
          />
        )}
      </View>

      {/* Group Details Modal */}
      <Modal visible={modalState.type === "group"} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{modalState.group?.name}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.groupInfo}>
              <Text style={styles.groupInfoDescription}>
                {modalState.group?.description || "No description"}
              </Text>
              <View style={styles.groupMeta}>
                <Text style={styles.groupMetaText}>
                  {modalState.group?.is_public ? "Public" : "Private"} Group
                </Text>
                <Text style={styles.groupMetaText}>
                  {modalState.group?.is_announcement ? "Announcements" : "Chat"}
                </Text>
                <Text style={styles.groupMetaText}>
                  {groupMembers.length} Members
                </Text>
              </View>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => openModal("addUser", modalState.group)}
              >
                <Ionicons name="person-add" size={20} color="#007AFF" />
                <Text style={styles.actionButtonText}>Add Users</Text>
              </TouchableOpacity>

              {modalState.group?.is_announcement && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => openModal("permissions", modalState.group)}
                >
                  <Ionicons name="keypad" size={20} color="#28a745" />
                  <Text style={styles.actionButtonText}>Permissions</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.membersTitle}>Group Members</Text>

            {groupMembers.length === 0 ? (
              <Text style={styles.noMembersText}>No members in this group</Text>
            ) : (
              groupMembers.map((member) => (
                <View key={member.id} style={styles.memberItem}>
                  <View style={styles.memberInfo}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {member.full_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.memberName}>{member.full_name}</Text>
                      <Text style={styles.memberEmail}>{member.email}</Text>
                      <Text style={styles.memberRole}>{member.role}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeUserFromGroup(member.id)}
                    style={styles.removeButton}
                  >
                    <Ionicons name="person-remove" size={20} color="#dc3545" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Create Group Modal */}
      <Modal
        visible={modalState.type === "create"}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TouchableOpacity onPress={closeModal}>
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

      {/* Add User to Group Modal - Updated for multiple users */}
      <Modal
        visible={modalState.type === "addUser"}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Add Users to {modalState.group?.name || "Group"}
              </Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalContent}>
              {allUsers.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No users available</Text>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={closeModal}
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
                  <View style={styles.searchHeader}>
                    <TextInput
                      placeholder="Search users by name or email"
                      value={userSearchQuery}
                      onChangeText={handleUserSearch}
                      style={styles.searchInput}
                      autoCapitalize="none"
                      placeholderTextColor="#888"
                    />

                    {filteredUsers.length > 0 && (
                      <View style={styles.bulkActions}>
                        <TouchableOpacity
                          style={styles.bulkActionButton}
                          onPress={selectAllUsers}
                        >
                          <Ionicons name="checkbox" size={16} color="#007AFF" />
                          <Text style={styles.bulkActionText}>Select All</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.bulkActionButton}
                          onPress={deselectAllUsers}
                        >
                          <Ionicons
                            name="square-outline"
                            size={16}
                            color="#666"
                          />
                          <Text style={styles.bulkActionText}>
                            Deselect All
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  <ScrollView
                    style={styles.scrollBox}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    {filteredUsers.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={[
                          styles.option,
                          selectedUsers.includes(user.id) &&
                            styles.optionSelected,
                        ]}
                        onPress={() => toggleUserSelection(user.id)}
                      >
                        <View style={styles.userOptionContent}>
                          <View style={styles.checkbox}>
                            {selectedUsers.includes(user.id) ? (
                              <Ionicons
                                name="checkbox"
                                size={20}
                                color="#007AFF"
                              />
                            ) : (
                              <Ionicons
                                name="square-outline"
                                size={20}
                                color="#ccc"
                              />
                            )}
                          </View>
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                              {user.full_name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.userInfo}>
                            <Text style={styles.optionText}>
                              {user.full_name}
                            </Text>
                            <Text style={styles.optionSubtext}>
                              {user.email}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {filteredUsers.length === 0 && (
                      <Text style={styles.noResultsText}>No users found</Text>
                    )}
                  </ScrollView>

                  <View style={styles.modalButtonContainer}>
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.secondaryButton,
                        styles.cancelButton,
                      ]}
                      onPress={closeModal}
                    >
                      <Text
                        style={[styles.buttonText, styles.secondaryButtonText]}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>

                    {filteredUsers.length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.button,
                          styles.secondaryButton,
                          styles.addAllButton,
                        ]}
                        onPress={addAllUsersToGroup}
                      >
                        <Text
                          style={[
                            styles.buttonText,
                            styles.secondaryButtonText,
                          ]}
                        >
                          Add All
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.button,
                        selectedUsers.length === 0 && styles.buttonDisabled,
                      ]}
                      onPress={addUsersToGroup}
                      disabled={selectedUsers.length === 0}
                    >
                      <Text style={styles.buttonText}>
                        Add Selected ({selectedUsers.length})
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Permissions Modal */}
      <Modal
        visible={modalState.type === "permissions"}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalDialog, styles.permissionsDialog]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Message Permissions</Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <Text style={styles.permissionHelpText}>
                For announcement groups, only users with permission can send
                messages. Admins always have permission.
              </Text>

              {groupMembers.map((member) => (
                <View key={member.id} style={styles.permissionItem}>
                  <View style={styles.memberInfo}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {member.full_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.memberName}>{member.full_name}</Text>
                      <Text style={styles.memberEmail}>{member.email}</Text>
                      <Text style={styles.memberRole}>{member.role}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.permissionToggle,
                      (messagePermissions[member.id] ||
                        member.role === "admin") &&
                        styles.permissionEnabled,
                    ]}
                    onPress={() => {
                      if (member.role !== "admin") {
                        updateMessagePermission(
                          member.id,
                          !messagePermissions[member.id]
                        );
                      }
                    }}
                    disabled={
                      member.role === "admin" ||
                      permissionLoading ===
                        `${modalState.group?.id}-${member.id}`
                    }
                  >
                    {permissionLoading ===
                    `${modalState.group?.id}-${member.id}` ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text style={styles.permissionToggleText}>
                        {member.role === "admin"
                          ? "Admin"
                          : messagePermissions[member.id]
                          ? "Allowed"
                          : "Denied"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
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
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  createButtonText: {
    color: "white",
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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
  modalContainer: {
    flex: 1,
    backgroundColor: "white",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalDialog: {
    width: "100%",
    maxHeight: "80%",
    backgroundColor: "white",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  permissionsDialog: {
    maxHeight: "90%",
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
    fontWeight: "600",
    color: "#333",
  },
  modalContent: {
    padding: 16,
  },
  groupInfo: {
    marginBottom: 24,
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
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f9fa",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e9ecef",
    gap: 8,
  },
  actionButtonText: {
    fontWeight: "600",
    color: "#333",
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
  input: {
    borderWidth: 1,
    borderColor: "#d0d4d8",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#d0d4d8",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
    color: "black",
    flex: 1,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
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
  },
  switchThumbActive: {
    transform: [{ translateX: 24 }],
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#b0b8c1",
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#d0d4d8",
  },
  secondaryButtonText: {
    color: "#1a1c1e",
  },
  cancelButton: {
    flex: 1,
    marginRight: 8,
  },
  addAllButton: {
    marginRight: 8,
  },
  scrollBox: {
    maxHeight: 200,
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
  userOptionContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  optionSelected: {
    backgroundColor: "#007bff22",
  },
  optionText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1a1c1e",
  },
  optionSubtext: {
    fontSize: 14,
    color: "#666",
  },
  noResultsText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    padding: 16,
  },
  modalButtonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
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
  publicBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "green",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  searchHeader: {
    flexDirection: "column",
    marginBottom: 16,
  },
  bulkActions: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 16,
    marginTop: 8,
  },
  bulkActionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
  },
  bulkActionText: {
    fontSize: 14,
    marginLeft: 4,
    color: "#666",
  },
});
