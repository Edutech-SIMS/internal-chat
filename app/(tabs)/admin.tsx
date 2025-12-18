import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatCard } from "../../components/StatCard";
import { ThemedText as Text } from "../../components/ThemedText";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

export default function AdminScreen() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const router = useRouter();

  const [stats, setStats] = useState({
    total: 0,
    teachers: 0,
    parents: 0,
  });
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [school, setSchool] = useState<any>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Fetch School Info
      const { data: schoolData } = await supabase
        .from("schools")
        .select("*")
        .eq("id", profile?.school_id)
        .single();
      setSchool(schoolData);

      // Fetch Stats
      const { data: users, error: usersError } = await supabase
        .from("profiles")
        .select(
          "id, user_id, full_name, email, mobile_number, avatar_url, created_at, user_roles(role)"
        )
        .eq("school_id", profile?.school_id)
        .order("created_at", { ascending: false });

      if (usersError) throw usersError;

      const teacherCount =
        users?.filter((u) =>
          u.user_roles?.some((r: any) => r.role === "teacher")
        ).length || 0;
      const parentCount =
        users?.filter((u) =>
          u.user_roles?.some((r: any) => r.role === "parent")
        ).length || 0;

      setStats({
        total: users?.length || 0,
        teachers: teacherCount,
        parents: parentCount,
      });

      setAllUsers(users || []);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const filteredUsers = allUsers.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUserPress = (user: any) => {
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const renderDetailRow = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string | null | undefined
  ) => (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.detailLabel, { color: colors.placeholderText }]}>
          {label}
        </Text>
        <Text style={[styles.detailValue, { color: colors.text }]}>
          {value || "N/A"}
        </Text>
      </View>
    </View>
  );

  const renderUserModal = () => {
    if (!selectedUser) return null;

    return (
      <Modal
        visible={showUserModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowUserModal(false)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}
        >
          <View
            style={[
              styles.modalContentFixed,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                User Profile
              </Text>
              <TouchableOpacity onPress={() => setShowUserModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalProfileSection}>
                <View
                  style={[
                    styles.modalAvatar,
                    { backgroundColor: colors.primary + "15" },
                  ]}
                >
                  {selectedUser.avatar_url ? (
                    <Image
                      source={{ uri: selectedUser.avatar_url }}
                      style={{ width: 80, height: 80, borderRadius: 40 }}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.modalAvatarText,
                        { color: colors.primary },
                      ]}
                    >
                      {selectedUser.full_name?.[0]?.toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text style={[styles.userNameLarge, { color: colors.text }]}>
                  {selectedUser.full_name}
                </Text>
                <Text
                  style={[
                    styles.userEmailLarge,
                    { color: colors.placeholderText },
                  ]}
                >
                  {selectedUser.email}
                </Text>
              </View>

              <View
                style={[styles.detailSection, { backgroundColor: colors.card }]}
              >
                <Text
                  style={[styles.detailSectionTitle, { color: colors.primary }]}
                >
                  ACCOUNT INFORMATION
                </Text>
                {renderDetailRow(
                  "mail-outline",
                  "Email Address",
                  selectedUser.email
                )}
                {renderDetailRow(
                  "call-outline",
                  "Mobile Number",
                  selectedUser.mobile_number
                )}
                {renderDetailRow(
                  "calendar-outline",
                  "Joined Date",
                  new Date(selectedUser.created_at).toLocaleDateString()
                )}
                <View style={styles.detailRow}>
                  <Ionicons
                    name="shield-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.detailLabel,
                        { color: colors.placeholderText },
                      ]}
                    >
                      Assigned Roles
                    </Text>
                    <View style={styles.rolesContainer}>
                      {selectedUser.user_roles?.map((r: any, index: number) => (
                        <View
                          key={index}
                          style={[
                            styles.roleBadge,
                            { backgroundColor: colors.primary + "20" },
                          ]}
                        >
                          <Text
                            style={[styles.roleText, { color: colors.primary }]}
                          >
                            {r.role}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View>
        <Text style={[styles.greeting, { color: colors.text }]}>
          Hello, Admin
        </Text>
        <Text
          style={[
            styles.schoolName,
            { color: isDarkMode ? "#94A3B8" : "#64748B" },
          ]}
        >
          {school?.name || "School Administration"}
        </Text>
      </View>
      <TouchableOpacity
        style={[
          styles.profileButton,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
          },
        ]}
        onPress={() => router.push("/(tabs)/settings")}
      >
        <Ionicons name="person" size={22} color={colors.primary} />
        <View style={[styles.profileStatus, { backgroundColor: "#10B981" }]} />
      </TouchableOpacity>
    </View>
  );

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <StatCard
        label="Total Users"
        value={stats.total}
        icon="people"
        colors={["#4F46E5", "#3730A3"]}
      />
      <StatCard
        label="Teachers"
        value={stats.teachers}
        icon="school"
        colors={["#10B981", "#059669"]}
      />
      <StatCard
        label="Parents"
        value={stats.parents}
        icon="home"
        colors={["#F59E0B", "#D97706"]}
      />
    </View>
  );

  // renderSystemUsers is now integrated into the main return for better scroll control

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.container, { flex: 1, paddingBottom: 0 }]}>
        {renderHeader()}
        {renderStats()}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            System Users
          </Text>
          <Text style={{ color: colors.placeholderText, fontSize: 13 }}>
            {filteredUsers.length} Total
          </Text>
        </View>

        <View
          style={[
            styles.searchContainer,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search" size={20} color={colors.placeholderText} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search name or email..."
            placeholderTextColor={colors.placeholderText}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons
                name="close-circle"
                size={20}
                color={colors.placeholderText}
              />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={({ item: user }) => (
            <TouchableOpacity
              style={[styles.activityItem, { backgroundColor: colors.card }]}
              onPress={() => handleUserPress(user)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.activityIcon,
                  { backgroundColor: colors.primary + "15" },
                ]}
              >
                <Text style={{ color: colors.primary, fontWeight: "bold" }}>
                  {user.full_name?.[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={styles.activityContent}>
                <Text style={[styles.activityTitle, { color: colors.text }]}>
                  {user.full_name}
                </Text>
                <Text
                  style={[
                    styles.activitySubtitle,
                    { color: colors.placeholderText },
                  ]}
                >
                  {user.user_roles?.map((r: any) => r.role).join(", ") ||
                    "No Role"}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.placeholderText}
              />
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={{ color: colors.placeholderText }}>
                No users found
              </Text>
            </View>
          }
        />
      </View>

      {renderUserModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
    paddingTop: 10,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "bold",
  },
  schoolName: {
    fontSize: 16,
    opacity: 0.7,
    marginTop: 4,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  profileStatus: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
    gap: 10,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  activitySubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  rolesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContentFixed: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "60%",
    paddingBottom: 20,
  },
  modalBody: {
    padding: 20,
  },
  modalProfileSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  modalAvatarText: {
    fontSize: 32,
    fontWeight: "bold",
  },
  userNameLarge: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 4,
  },
  userEmailLarge: {
    fontSize: 14,
  },
  detailSection: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailSectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 12,
    letterSpacing: 1,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  emptyContainer: {
    alignItems: "center",
    padding: 40,
  },
});
