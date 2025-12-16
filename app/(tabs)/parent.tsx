import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import ParentAssessmentHistory from "../../components/ParentAssessmentHistory";
import ParentAttendance from "../../components/ParentAttendance";
import ParentDashboard from "../../components/ParentDashboard";
import ParentTransport from "../../components/ParentTransport";
import { useTheme } from "../../contexts/ThemeContext";
import { getThemeColors } from "../../themes";

export default function ParentScreen() {
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "transport" | "assessment" | "attendance"
  >("dashboard");

  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleNavigation = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <ParentDashboard onNavigate={handleNavigation} />;
      case "transport":
        return <ParentTransport />;
      case "assessment":
        return <ParentAssessmentHistory />;
      case "attendance":
        return <ParentAttendance />;
      default:
        return <ParentDashboard onNavigate={handleNavigation} />;
    }
  };

  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: "home-outline" },
    { id: "transport", label: "Transport", icon: "bus-outline" },
    { id: "assessment", label: "Reports & Grades", icon: "clipboard-outline" },
    { id: "attendance", label: "Attendance", icon: "calendar-outline" },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {/* Header with Menu Button */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={toggleSidebar} style={styles.menuButton}>
          <Ionicons name="menu" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
        </Text>
      </View>

      {/* Main Content */}
      <View style={styles.content}>{renderContent()}</View>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <View style={styles.overlayContainer}>
          {/* Backdrop */}
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setIsSidebarOpen(false)}
          />

          {/* Sidebar Panel */}
          <View style={[styles.sidebar, { backgroundColor: colors.card }]}>
            <View
              style={[
                styles.sidebarHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.sidebarTitle, { color: colors.text }]}>
                Menu
              </Text>
              <TouchableOpacity onPress={() => setIsSidebarOpen(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.sidebarContent}>
              {menuItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.sidebarItem,
                    activeTab === item.id && {
                      backgroundColor: colors.primary + "15",
                    },
                  ]}
                  onPress={() => handleNavigation(item.id as any)}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={activeTab === item.id ? colors.primary : colors.text}
                  />
                  <Text
                    style={[
                      styles.sidebarItemText,
                      {
                        color:
                          activeTab === item.id ? colors.primary : colors.text,
                      },
                      activeTab === item.id && { fontWeight: "700" },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Sidebar Footer */}
            <View
              style={[styles.sidebarFooter, { borderTopColor: colors.border }]}
            >
              <TouchableOpacity style={styles.sidebarItem}>
                <Ionicons name="log-out-outline" size={22} color="#dc3545" />
                <Text style={[styles.sidebarItemText, { color: "#dc3545" }]}>
                  Sign Out
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  menuButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  content: {
    flex: 1,
  },
  // Sidebar Styles
  overlayContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    flexDirection: "row",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sidebar: {
    width: "75%",
    height: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  sidebarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingTop: 50, // Safe area equivalent roughly
    borderBottomWidth: 1,
  },
  sidebarTitle: {
    fontSize: 22,
    fontWeight: "bold",
  },
  sidebarContent: {
    padding: 16,
    gap: 8,
  },
  sidebarItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  sidebarItemText: {
    fontSize: 16,
    fontWeight: "500",
  },
  sidebarFooter: {
    marginTop: "auto",
    padding: 16,
    borderTopWidth: 1,
  },
});
