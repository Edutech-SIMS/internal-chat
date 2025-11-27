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

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <ParentDashboard onNavigate={setActiveTab} />;
      case "transport":
        return <ParentTransport />;
      case "assessment":
        return <ParentAssessmentHistory />;
      case "attendance":
        return <ParentAttendance />;
      default:
        return <ParentDashboard onNavigate={setActiveTab} />;
    }
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "home" },
    { id: "transport", label: "Transport", icon: "bus" },
    { id: "assessment", label: "Assessment", icon: "clipboard" },
    { id: "attendance", label: "Attendance", icon: "calendar" },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          My Children
        </Text>
      </View>

      <View style={styles.tabWrapper}>
        <View
          style={[
            styles.tabContainer,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tab,
                activeTab === tab.id && {
                  backgroundColor: colors.background,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.1,
                  shadowRadius: 2,
                  elevation: 2,
                },
              ]}
              onPress={() => setActiveTab(tab.id as any)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={
                  activeTab === tab.id ? colors.primary : colors.placeholderText
                }
                style={{ marginBottom: 4 }}
              />
              <Text
                style={[
                  styles.tabText,
                  {
                    color:
                      activeTab === tab.id
                        ? colors.text
                        : colors.placeholderText,
                  },
                  activeTab === tab.id && styles.activeTabText,
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.content}>{renderContent()}</View>
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
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  tabWrapper: {
    paddingVertical: 12,
  },
  tabContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "600",
  },
  activeTabText: {
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
});
