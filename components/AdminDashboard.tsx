import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { getThemeColors } from "../themes";

export default function AdminDashboard() {
  const { user, profile, school } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const router = useRouter();

  const [stats, setStats] = useState({
    total: 0,
    teachers: 0,
    parents: 0,
    students: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showAllUsersModal, setShowAllUsersModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchDashboardData();
    }
  }, [user?.id, profile?.school_id]);

  const fetchDashboardData = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) setLoading(true);

      // Fetch users for stats
      const { data: usersData, error: usersError } = await supabase
        .from("profiles")
        .select(
          `
          id,
          full_name,
          email,
          created_at,
          user_roles (role)
        `
        )
        .eq("school_id", profile?.school_id)
        .order("created_at", { ascending: false });

      if (usersError) throw usersError;

      const users = usersData || [];
      setAllUsers(users);

      // Calculate stats
      const total = users.length;
      const teachers = users.filter((u) =>
        u.user_roles?.some((r: any) => r.role === "teacher")
      ).length;
      const parents = users.filter((u) =>
        u.user_roles?.some((r: any) => r.role === "parent")
      ).length;
      const students = users.filter((u) =>
        u.user_roles?.some((r: any) => r.role === "student")
      ).length;

      setStats({ total, teachers, parents, students });
      setRecentUsers(users.slice(0, 5)); // Top 5 recent users
    } catch (error) {
      console.error("Error fetching admin dashboard data:", error);
      Alert.alert("Error", "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData(true);
    setRefreshing(false);
  };

  const filteredUsers = allUsers.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View>
        <Text style={[styles.greeting, { color: colors.text }]}>
          Admin Dashboard
        </Text>
        <Text style={[styles.schoolName, { color: colors.text }]}>
          {school?.name || "School Administration"}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.profileButton, { backgroundColor: colors.card }]}
      >
        <Ionicons name="person" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#e3f2fd" }]}>
          <Ionicons name="people" size={24} color="#007AFF" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {stats.total}
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Total Users
        </Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#e8f5e9" }]}>
          <Ionicons name="school" size={24} color="#28a745" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {stats.teachers}
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Teachers
        </Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#fff3e0" }]}>
          <Ionicons name="home" size={24} color="#ff9800" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {stats.parents}
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Parents
        </Text>
      </View>
    </View>
  );

  const renderQuickActions = () => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Quick Actions
      </Text>
      <View style={styles.quickActionsGrid}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={() => setShowAllUsersModal(true)}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#e6f0ff" }]}>
            <Ionicons name="people" size={24} color="#007AFF" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Manage Users
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={() => router.push("/groups")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#fff0e6" }]}>
            <Ionicons name="git-branch" size={24} color="#FF9500" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Manage Groups
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={() => router.push("/settings")}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#f3e5f5" }]}>
            <Ionicons name="settings" size={24} color="#9c27b0" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Settings
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={() =>
            Alert.alert("Coming Soon", "Reports module coming soon")
          }
        >
          <View style={[styles.actionIcon, { backgroundColor: "#e0f2f1" }]}>
            <Ionicons name="bar-chart" size={24} color="#009688" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Reports
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderRecentActivity = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Recent Users
        </Text>
        <TouchableOpacity onPress={() => setShowAllUsersModal(true)}>
          <Text style={[styles.seeAllText, { color: colors.primary }]}>
            View All
          </Text>
        </TouchableOpacity>
      </View>
      {recentUsers.map((user) => (
        <View
          key={user.id}
          style={[styles.activityItem, { backgroundColor: colors.card }]}
        >
          <View
            style={[styles.activityIcon, { backgroundColor: colors.border }]}
          >
            <Ionicons
              name="person-add"
              size={16}
              color={colors.placeholderText}
            />
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
              {user.user_roles?.map((r: any) => r.role).join(", ") || "No Role"}
            </Text>
          </View>
          <Text
            style={[styles.activityTime, { color: colors.placeholderText }]}
          >
            {new Date(user.created_at).toLocaleDateString()}
          </Text>
        </View>
      ))}
    </View>
  );

  const renderUserItem = ({ item }: { item: any }) => (
    <View
      style={[
        styles.userItem,
        { backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
    >
      <View style={[styles.userAvatar, { backgroundColor: colors.border }]}>
        <Text style={[styles.avatarText, { color: colors.text }]}>
          {item.full_name?.[0]?.toUpperCase() || "?"}
        </Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.text }]}>
          {item.full_name}
        </Text>
        <Text style={[styles.userEmail, { color: colors.placeholderText }]}>
          {item.email}
        </Text>
        <View style={styles.rolesContainer}>
          {item.user_roles?.map((r: any, index: number) => (
            <View
              key={index}
              style={[
                styles.roleBadge,
                { backgroundColor: colors.primary + "20" },
              ]}
            >
              <Text style={[styles.roleText, { color: colors.primary }]}>
                {r.role}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

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
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {renderHeader()}
        {renderStats()}
        {renderQuickActions()}
        {renderRecentActivity()}
      </ScrollView>

      {/* All Users Modal */}
      <Modal
        visible={showAllUsersModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAllUsersModal(false)}
      >
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: colors.background },
          ]}
        >
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              All Users
            </Text>
            <TouchableOpacity onPress={() => setShowAllUsersModal(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View
            style={[styles.searchContainer, { backgroundColor: colors.card }]}
          >
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
            renderItem={renderUserItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text
                  style={[styles.emptyText, { color: colors.placeholderText }]}
                >
                  No users found
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
  container: {
    flex: 1,
    padding: 16,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 16,
    opacity: 0.7,
  },
  schoolName: {
    fontSize: 24,
    fontWeight: "bold",
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    marginHorizontal: 4,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  actionButton: {
    width: "48%",
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionText: {
    fontWeight: "600",
    fontSize: 14,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
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
    fontSize: 16,
    fontWeight: "600",
  },
  activitySubtitle: {
    fontSize: 14,
  },
  activityTime: {
    fontSize: 12,
  },
  modalContainer: {
    flex: 1,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  userItem: {
    flexDirection: "row",
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderBottomWidth: 1,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  userInfo: {
    flex: 1,
    justifyContent: "center",
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    marginBottom: 8,
  },
  rolesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  emptyState: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
  },
});
