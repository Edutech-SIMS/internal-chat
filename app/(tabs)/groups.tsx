import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  created_by: string;
  member_count: number;
}

interface GroupMember {
  id: string;
  user_id: string;
  profile_id?: string;
  joined_at: string;
  can_send_messages?: boolean;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  user_roles?: { role: string }[]; // Add roles property
}

// Update the RawGroupMemberData interface
interface RawGroupMemberData {
  id: string;
  user_id: string;
  joined_at: string;
  profiles:
    | {
        id: string;
        full_name: string | null;
        email: string | null;
      }[]
    | {
        id: string;
        full_name: string | null;
        email: string | null;
      }
    | null;
  // Remove direct user property reference since it causes typing issues
}

interface User {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  user_roles?: { role: string }[]; // Add roles property
}

export default function GroupsScreen() {
  const { hasRole, profile, user } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const router = useRouter();
  const params = useLocalSearchParams();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUsersForCreate, setSelectedUsersForCreate] = useState<
    Set<string>
  >(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<string>("all"); // Role filter for members modal
  const [addMemberRoleFilter, setAddMemberRoleFilter] = useState<string>("all"); // Role filter for add member modal
  const [newGroup, setNewGroup] = useState({
    name: "",
    description: "",
    is_public: true,
    is_announcement: false,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = hasRole("admin") || hasRole("superadmin");

  // Log the user roles to the console
  useEffect(() => {
    console.log("User roles:", profile?.roles);
    console.log("Has admin role:", hasRole("admin"));
    console.log("Has superadmin role:", hasRole("superadmin"));
    console.log(
      "Is admin (combined):",
      hasRole("admin") || hasRole("superadmin")
    );
  }, [profile, hasRole]);

  // Handle groupId parameter to automatically open group members modal
  useEffect(() => {
    const groupId = params.groupId as string;
    if (groupId && groups.length > 0) {
      const group = groups.find((g) => g.id === groupId);
      if (group) {
        handleViewMembers(group);
      }
    }
  }, [params.groupId, groups]);

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
      // Fetch members
      const { data, error } = await supabase
        .from("group_members")
        .select(
          `
          id,
          user_id,
          joined_at,
          profiles (
            id,
            full_name,
            email
          )
        `
        )
        .eq("group_id", groupId);

      if (error) throw error;

      // Fetch permissions for this group
      const { data: permissionsData, error: permissionsError } = await supabase
        .from("group_message_permissions")
        .select("user_id, can_send_messages")
        .eq("group_id", groupId);

      if (permissionsError && permissionsError.code !== "PGRST116") {
        console.error("Error fetching permissions:", permissionsError);
      }

      // Create a map of permissions
      // Note: group_message_permissions.user_id references profiles.id
      const permissionsMap = new Map();
      if (permissionsData) {
        permissionsData.forEach((p) => {
          permissionsMap.set(p.user_id, p.can_send_messages);
        });
      }

      // Cast the data to the expected type with unknown first to avoid TS errors
      const rawData = data as unknown as RawGroupMemberData[] | null;

      // Fetch roles for all members by joining with profiles and user_roles
      const profileIds =
        rawData
          ?.map((member) => {
            if (member.profiles) {
              if (
                Array.isArray(member.profiles) &&
                member.profiles.length > 0
              ) {
                return member.profiles[0].id;
              } else if (!Array.isArray(member.profiles)) {
                return member.profiles.id;
              }
            }
            return null;
          })
          .filter(Boolean) || [];

      let userRolesMap = new Map<string, { role: string }[]>();

      if (profileIds.length > 0) {
        const { data: userRolesData, error: rolesError } = await supabase
          .from("profiles")
          .select(
            `
            id,
            user_id,
            user_roles:user_roles(role)
          `
          )
          .in("id", profileIds);

        if (rolesError) {
          console.error("Error fetching user roles:", rolesError);
        } else {
          // Create a map of user roles using user_id as key
          userRolesData?.forEach((profile) => {
            if (profile.user_id) {
              userRolesMap.set(profile.user_id, profile.user_roles || []);
            }
          });
        }
      }

      const transformedData: GroupMember[] = (rawData || []).map((member) => {
        // Handle case where profiles might be an array (unexpected but possible)
        let profileData = null;
        let profileId: string | undefined;

        if (member.profiles) {
          if (Array.isArray(member.profiles) && member.profiles.length > 0) {
            // If it's an array, take the first item
            profileData = {
              id: member.profiles[0].id,
              full_name: member.profiles[0].full_name || null,
              email: member.profiles[0].email || null,
            };
            profileId = member.profiles[0].id;
          } else if (!Array.isArray(member.profiles)) {
            // If it's an object, use it directly
            profileData = {
              id: member.profiles.id,
              full_name: member.profiles.full_name || null,
              email: member.profiles.email || null,
            };
            profileId = member.profiles.id;
          }
        }

        // Get user roles from the map using user_id
        const userRoles = member.user_id
          ? userRolesMap.get(member.user_id) || []
          : [];

        // Log member roles for debugging
        console.log(
          `Member ${
            profileData?.full_name || profileData?.email || "Unknown"
          } roles:`,
          userRoles
        );

        return {
          id: member.id,
          user_id: member.user_id,
          profile_id: profileId,
          joined_at: member.joined_at,
          profiles: profileData,
          user_roles: userRoles, // Include user roles in the transformed data
          // Check permission using Profile ID
          can_send_messages:
            profileId && permissionsMap.has(profileId)
              ? permissionsMap.get(profileId)
              : false,
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
      // Fetch all users in the school with their roles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select(
          `
          id, 
          user_id, 
          full_name, 
          email,
          user_roles:user_roles(role)
        `
        )
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

  const loadAllUsers = async () => {
    try {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email")
        .eq("school_id", profile?.school_id);

      if (error) throw error;

      // Filter out the current user
      const otherUsers = profiles?.filter((p) => p.user_id !== user?.id) || [];
      setAllUsers(otherUsers);
    } catch (error: any) {
      console.error("Error loading all users:", error);
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

      // Add selected members
      if (selectedUsersForCreate.size > 0) {
        const membersToAdd = Array.from(selectedUsersForCreate).map(
          (userId) => ({
            group_id: groupData.id,
            user_id: userId,
          })
        );

        const { error: batchError } = await supabase
          .from("group_members")
          .insert(membersToAdd);

        if (batchError) throw batchError;
      }

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
      setSelectedUsersForCreate(new Set());
      setSearchQuery("");
      setMemberSearchQuery(""); // Reset member search
      setAddMemberSearchQuery(""); // Reset add member search

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
    setMemberSearchQuery(""); // Reset search when opening modal
    setMemberRoleFilter("all"); // Reset role filter when opening modal
    await loadGroupMembers(group.id);
    setShowMembersModal(true);
  };

  const openAddMemberModal = async (group: Group) => {
    setSelectedGroup(group);
    setAddMemberSearchQuery(""); // Reset add member search when opening modal
    setAddMemberRoleFilter("all"); // Reset add member role filter when opening modal
    await loadAvailableUsers(group);
    setShowAddMemberModal(true);
  };

  const handleAddMember = async (userId: string, userName: string) => {
    if (!selectedGroup) return;

    Alert.alert(
      "Add Member",
      `Are you sure you want to add ${userName} to this group?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: async () => {
            try {
              const { error } = await supabase.from("group_members").insert({
                group_id: selectedGroup.id,
                user_id: userId,
              });

              if (error) throw error;

              // Refresh members list
              await loadGroupMembers(selectedGroup.id);
              // Only reload available users if we're still in the add member modal
              if (showAddMemberModal && selectedGroup) {
                await loadAvailableUsers(selectedGroup);
              }

              Alert.alert("Success", `Added ${userName} to the group`);
            } catch (error: any) {
              console.error("Error adding member:", error);
              Alert.alert(
                "Error",
                error.message || "Failed to add member to group"
              );
            }
          },
        },
      ]
    );
  };

  const toggleMessagePermission = async (
    memberId: string,
    profileId: string | undefined,
    currentStatus: boolean
  ) => {
    if (!selectedGroup) return;
    if (!profileId) {
      Alert.alert("Error", "Cannot set permission: User profile not found");
      return;
    }

    try {
      const newStatus = !currentStatus;

      // Optimistic update
      setGroupMembers((prev) =>
        prev.map((m) =>
          m.id === memberId ? { ...m, can_send_messages: newStatus } : m
        )
      );

      console.log("Toggling permission for profile:", profileId);

      const { error } = await supabase.from("group_message_permissions").upsert(
        {
          group_id: selectedGroup.id,
          user_id: profileId, // Using Profile ID as required by schema
          can_send_messages: newStatus,
        },
        { onConflict: "group_id,user_id" }
      );

      if (error) {
        console.error("Supabase error toggling permission:", error);
        // Revert on error
        setGroupMembers((prev) =>
          prev.map((m) =>
            m.id === memberId ? { ...m, can_send_messages: currentStatus } : m
          )
        );
        throw error;
      }

      Alert.alert("Success", "Permission updated successfully");
    } catch (error: any) {
      console.error("Error toggling permission:", error);
      Alert.alert(
        "Error",
        "Failed to update permission: " + (error.message || "Unknown error")
      );
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
                // Also refresh available users if the add member modal is open
                if (showAddMemberModal) {
                  await loadAvailableUsers(selectedGroup);
                }
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
      <View
        key={group.id}
        style={[styles.groupCard, { backgroundColor: colors.card }]}
      >
        <View style={styles.groupHeader}>
          <View
            style={[
              styles.groupIcon,
              { backgroundColor: colors.primary + "20" },
            ]}
          >
            <Ionicons
              name={
                group.is_announcement ? "megaphone-outline" : "people-outline"
              }
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={styles.groupInfo}>
            <Text style={[styles.groupName, { color: colors.text }]}>
              {group.name}
            </Text>
            <Text
              style={[
                styles.groupDescription,
                { color: colors.placeholderText },
              ]}
              numberOfLines={1}
            >
              {group.description || "No description"}
            </Text>
          </View>
        </View>

        <View style={styles.groupDetails}>
          <View style={styles.detailItem}>
            <Ionicons
              name="person-outline"
              size={16}
              color={colors.placeholderText}
            />
            <Text
              style={[styles.detailText, { color: colors.placeholderText }]}
            >
              {group.member_count} members
            </Text>
          </View>
          <View style={styles.detailItem}>
            {group.is_public ? (
              <Ionicons name="globe-outline" size={16} color="#28a745" />
            ) : (
              <Ionicons name="lock-closed-outline" size={16} color="#ffc107" />
            )}
            <Text
              style={[styles.detailText, { color: colors.placeholderText }]}
            >
              {group.is_public ? "Public" : "Private"}
            </Text>
          </View>
          {group.is_announcement && (
            <View style={styles.detailItem}>
              <Ionicons name="megaphone-outline" size={16} color="#dc3545" />
              <Text
                style={[styles.detailText, { color: colors.placeholderText }]}
              >
                Announcement
              </Text>
            </View>
          )}
        </View>

        <View style={styles.groupActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.border }]}
            onPress={() => handleViewMembers(group)}
          >
            <Text style={[styles.actionButtonText, { color: colors.text }]}>
              View Members
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={async () => {
              openAddMemberModal(group);
            }}
          >
            <Text style={[styles.actionButtonText, { color: "#fff" }]}>
              Add Member
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Helper function to format roles for display
  const formatUserRoles = (roles: { role: string }[] | undefined) => {
    if (!roles || roles.length === 0) return "No roles assigned";
    return roles.map((r) => r.role).join(", ");
  };

  // Helper function to check if member has admin or superadmin role
  const isMemberAdminOrSuperadmin = (member: GroupMember) => {
    if (!member.user_roles) return false;
    return member.user_roles.some(
      (role) => role.role === "admin" || role.role === "superadmin"
    );
  };

  const renderMemberItem = ({ item }: { item: GroupMember }) => (
    <View style={[styles.memberItem, { borderBottomColor: colors.border }]}>
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: colors.text }]}>
          {item.profiles?.full_name || item.profiles?.email || "Unknown User"}
        </Text>
        <Text style={[styles.memberEmail, { color: colors.placeholderText }]}>
          {item.profiles?.email && item.profiles?.full_name
            ? item.profiles.email
            : item.profiles?.full_name
            ? "No email"
            : ""}
        </Text>
        {/* Display user roles */}
        <Text
          style={[
            styles.memberEmail,
            { color: colors.placeholderText, fontStyle: "italic" },
          ]}
        >
          Role: {formatUserRoles(item.user_roles)}
        </Text>
      </View>
      {selectedGroup?.is_announcement &&
        // Only show toggle if the current user is an admin (which they are if they see this screen)
        // AND the target member is NOT the group creator (admins always have permission)
        item.user_id !== selectedGroup.created_by && (
          <View style={styles.permissionContainer}>
            <Text
              style={[
                styles.permissionLabel,
                { color: colors.placeholderText },
              ]}
            >
              Can Post
            </Text>
            <Switch
              value={item.can_send_messages}
              onValueChange={() =>
                toggleMessagePermission(
                  item.id,
                  item.profile_id,
                  item.can_send_messages || false
                )
              }
              trackColor={{ false: "#767577", true: colors.primary }}
              thumbColor={item.can_send_messages ? "#fff" : "#f4f3f4"}
            />
          </View>
        )}
      <Text style={[styles.joinedDate, { color: colors.placeholderText }]}>
        {new Date(item.joined_at).toLocaleDateString()}
      </Text>
      {/* Hide delete button for admin/superadmin users */}
      {!isMemberAdminOrSuperadmin(item) && (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() =>
            handleRemoveMember(item.id, item.profiles?.full_name || "User")
          }
        >
          <Ionicons name="close" size={20} color="#dc3545" />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderAvailableUserItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={[styles.userItem, { borderBottomColor: colors.border }]}
      onPress={async () => {
        await handleAddMember(item.user_id, item.full_name || "User");
        // Keep the modal open to allow adding more members
        // setShowAddMemberModal(false); // Commented out to keep modal open
      }}
    >
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.text }]}>
          {item.full_name}
        </Text>
        <Text style={[styles.userEmail, { color: colors.placeholderText }]}>
          {item.email}
        </Text>
        {/* Display user roles */}
        <Text
          style={[
            styles.userEmail,
            { color: colors.placeholderText, fontStyle: "italic" },
          ]}
        >
          Role: {formatUserRoles(item.user_roles)}
        </Text>
      </View>
      <Ionicons name="add" size={24} color={colors.primary} />
    </TouchableOpacity>
  );

  const toggleUserSelection = (userId: string) => {
    const newSelection = new Set(selectedUsersForCreate);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUsersForCreate(newSelection);
  };

  const renderUserSelectionItem = ({ item }: { item: User }) => {
    const isSelected = selectedUsersForCreate.has(item.user_id);
    return (
      <TouchableOpacity
        style={[styles.userItem, { borderBottomColor: colors.border }]}
        onPress={() => toggleUserSelection(item.user_id)}
      >
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>
            {item.full_name}
          </Text>
          <Text style={[styles.userEmail, { color: colors.placeholderText }]}>
            {item.email}
          </Text>
        </View>
        <Ionicons
          name={isSelected ? "checkbox" : "square-outline"}
          size={24}
          color={isSelected ? colors.primary : colors.placeholderText}
        />
      </TouchableOpacity>
    );
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // New filter for group members
  const filteredGroupMembers = groupMembers.filter((member) => {
    // Apply name/email search filter
    const matchesSearch =
      member.profiles?.full_name
        ?.toLowerCase()
        .includes(memberSearchQuery.toLowerCase()) ||
      member.profiles?.email
        ?.toLowerCase()
        .includes(memberSearchQuery.toLowerCase());

    // Apply role filter
    const matchesRole =
      memberRoleFilter === "all" ||
      (member.user_roles &&
        member.user_roles.some((role) => role.role === memberRoleFilter));

    return matchesSearch && matchesRole;
  });

  // Update the filteredAvailableUsers to include role filtering
  const filteredAvailableUsers = availableUsers.filter((user) => {
    // Apply name/email search filter
    const matchesSearch =
      user.full_name
        ?.toLowerCase()
        .includes(addMemberSearchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(addMemberSearchQuery.toLowerCase());

    // Apply role filter
    const matchesRole =
      addMemberRoleFilter === "all" ||
      (user.user_roles &&
        user.user_roles.some((role) => role.role === addMemberRoleFilter));

    return matchesSearch && matchesRole;
  });

  if (!isAdmin) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>
                Group Management
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.placeholderText }]}
              >
                Access restricted to administrators
              </Text>
            </View>
          </View>
          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.placeholderContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={60}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.placeholderText,
                    { color: colors.placeholderText },
                  ]}
                >
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
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              Group Management
            </Text>
            <Text style={[styles.subtitle, { color: colors.placeholderText }]}>
              Manage groups and memberships
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              loadAllUsers();
              setShowCreateModal(true);
            }}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {groups.length}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Total Groups
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {groups.filter((g) => g.is_public).length}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Public
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {groups.filter((g) => g.is_announcement).length}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Announcement
              </Text>
            </View>
          </View>

          {error ? (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.errorContainer}>
                <Ionicons name="warning" size={40} color="#d32f2f" />
                <Text style={[styles.errorText, { color: colors.text }]}>
                  Error loading data
                </Text>
                <Text
                  style={[
                    styles.errorDetail,
                    { color: colors.placeholderText },
                  ]}
                >
                  {error}
                </Text>
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
              <ActivityIndicator size="large" color={colors.primary} />
              <Text
                style={[
                  styles.placeholderText,
                  { color: colors.placeholderText },
                ]}
              >
                Loading groups...
              </Text>
            </View>
          ) : groups.length > 0 ? (
            groups.map(renderGroupItem)
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.placeholderContainer}>
                <Ionicons
                  name="git-branch-outline"
                  size={60}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.placeholderText,
                    { color: colors.placeholderText },
                  ]}
                >
                  No groups found
                </Text>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: colors.primary },
                  ]}
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
        presentationStyle="pageSheet"
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Create New Group
            </Text>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="Group Name"
            placeholderTextColor={colors.placeholderText}
            value={newGroup.name}
            onChangeText={(text) => setNewGroup({ ...newGroup, name: text })}
          />

          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="Description (optional)"
            placeholderTextColor={colors.placeholderText}
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
              onPress={() => {
                const isPublic = !newGroup.is_public;
                setNewGroup({
                  ...newGroup,
                  is_public: isPublic,
                  is_announcement: isPublic ? false : newGroup.is_announcement,
                });
              }}
            >
              <Ionicons
                name={newGroup.is_public ? "checkbox" : "square-outline"}
                size={20}
                color={colors.primary}
              />
              <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                Public Group
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.checkbox}
              onPress={() => {
                const isAnnouncement = !newGroup.is_announcement;
                setNewGroup({
                  ...newGroup,
                  is_announcement: isAnnouncement,
                  is_public: isAnnouncement ? false : newGroup.is_public,
                });
              }}
            >
              <Ionicons
                name={newGroup.is_announcement ? "checkbox" : "square-outline"}
                size={20}
                color={colors.primary}
              />
              <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                Announcement Group
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Add Members (Optional)
          </Text>
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={colors.placeholderText}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search users..."
              placeholderTextColor={colors.placeholderText}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.user_id}
            renderItem={renderUserSelectionItem}
            style={styles.userSelectionList}
            nestedScrollEnabled={true}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[
                styles.modalButton,
                styles.cancelButton,
                { backgroundColor: colors.border },
              ]}
              onPress={() => setShowCreateModal(false)}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalButton,
                styles.createButton,
                { backgroundColor: colors.primary },
              ]}
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
      </Modal>

      {/* Group Members Modal */}
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={showMembersModal}
        onRequestClose={() => setShowMembersModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {selectedGroup?.name} Members
            </Text>
            <TouchableOpacity onPress={() => setShowMembersModal(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.membersHeader}>
            <Text
              style={[styles.membersCount, { color: colors.placeholderText }]}
            >
              {groupMembers.length} member
              {groupMembers.length !== 1 ? "s" : ""}
            </Text>
          </View>

          {/* Add search input */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={colors.placeholderText}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search members..."
              placeholderTextColor={colors.placeholderText}
              value={memberSearchQuery}
              onChangeText={setMemberSearchQuery}
            />
          </View>

          <FlatList
            data={filteredGroupMembers}
            keyExtractor={(item) => item.id}
            renderItem={renderMemberItem}
            style={styles.membersList}
            ListEmptyComponent={
              <View style={styles.emptyMembers}>
                <Ionicons
                  name="people-outline"
                  size={48}
                  color={colors.placeholderText}
                />
                <Text
                  style={[
                    styles.emptyMembersText,
                    { color: colors.placeholderText },
                  ]}
                >
                  No members found
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
      </Modal>

      {/* Add Member Modal */}
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={showAddMemberModal}
        onRequestClose={() => setShowAddMemberModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Add Member
            </Text>
            <TouchableOpacity onPress={() => setShowAddMemberModal(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Add search input */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={colors.placeholderText}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search users..."
              placeholderTextColor={colors.placeholderText}
              value={addMemberSearchQuery}
              onChangeText={setAddMemberSearchQuery}
            />
          </View>

          {/* Add role filter chips */}
          <View style={styles.compactFilterContainer}>
            <Ionicons
              name="filter"
              size={16}
              color={colors.placeholderText}
              style={{ marginRight: 8 }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsContainer}
            >
              {[
                { label: "All", value: "all" },
                { label: "Admin", value: "admin" },
                { label: "Super Admin", value: "superadmin" },
                { label: "Parent", value: "parent" },
                { label: "Teacher", value: "teacher" },
                { label: "Student", value: "student" },
              ].map((role) => (
                <TouchableOpacity
                  key={role.value}
                  style={[
                    styles.filterChip,
                    addMemberRoleFilter === role.value && {
                      backgroundColor: colors.primary,
                    },
                    addMemberRoleFilter !== role.value && {
                      backgroundColor: colors.border,
                    },
                  ]}
                  onPress={() => setAddMemberRoleFilter(role.value)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      addMemberRoleFilter === role.value && { color: "#fff" },
                      addMemberRoleFilter !== role.value && {
                        color: colors.text,
                      },
                    ]}
                  >
                    {role.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <FlatList
            data={filteredAvailableUsers}
            keyExtractor={(item) => item.user_id}
            renderItem={renderAvailableUserItem}
            style={styles.membersList}
            ListEmptyComponent={
              <View style={styles.emptyMembers}>
                <Text
                  style={[
                    styles.emptyMembersText,
                    { color: colors.placeholderText },
                  ]}
                >
                  No available users to add
                </Text>
              </View>
            }
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    padding: 16,
  },
  statsCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  groupCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  groupIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 4,
  },
  groupDescription: {
    fontSize: 14,
  },
  groupDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
    gap: 12,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  detailText: {
    fontSize: 12,
  },
  groupActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  placeholderContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  placeholderText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  errorContainer: {
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
  },
  errorDetail: {
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#007AFF",
    borderRadius: 8,
  },
  modalContainer: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalContent: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
  },
  checkboxContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  checkbox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkboxLabel: {
    fontSize: 14,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "transparent",
  },
  cancelButtonText: {
    fontWeight: "600",
  },
  createButton: {
    backgroundColor: "#007AFF",
  },
  createButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  membersHeader: {
    marginBottom: 16,
  },
  membersCount: {
    fontSize: 14,
  },
  membersList: {
    flex: 1,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 12,
  },
  joinedDate: {
    fontSize: 12,
    marginRight: 12,
  },
  removeButton: {
    padding: 8,
  },
  emptyMembers: {
    alignItems: "center",
    padding: 32,
  },
  emptyMembersText: {
    marginTop: 12,
    fontSize: 14,
  },
  deleteButton: {
    backgroundColor: "#fee2e2",
  },
  deleteButtonText: {
    color: "#dc3545",
    fontWeight: "600",
  },
  userItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 12,
  },
  permissionContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
    gap: 8,
  },
  permissionLabel: {
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 8,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  userSelectionList: {
    flex: 1,
    marginBottom: 16,
  },
  compactFilterContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    height: 40,
  },
  filterChipsContainer: {
    alignItems: "center",
    paddingRight: 16,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
