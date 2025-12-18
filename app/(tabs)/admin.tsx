import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
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
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllUsersModal, setShowAllUsersModal] = useState(false);
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
        .select("id, full_name, email, created_at, user_roles(role)")
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
      setRecentUsers(users?.slice(0, 5) || []);
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
        {renderRecentActivity()}
      </ScrollView>

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
          <ScrollView style={styles.modalContent}>
            {filteredUsers.map((user) => (
              <View key={user.id}>{renderUserItem({ item: user })}</View>
            ))}
          </ScrollView>
        </View>
      </Modal>
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
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
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
  activityTime: {
    fontSize: 11,
  },
  modalContainer: {
    flex: 1,
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
  modalContent: {
    flex: 1,
    padding: 10,
  },
  userItem: {
    flexDirection: "row",
    padding: 15,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "600",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "bold",
  },
  userEmail: {
    fontSize: 14,
    marginTop: 2,
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
});
