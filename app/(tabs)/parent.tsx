import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ParentAssessmentHistory from "../../components/ParentAssessmentHistory";
import ParentDashboard from "../../components/ParentDashboard";
import ParentTransport from "../../components/ParentTransport";

export default function ParentScreen() {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "transport" | "assessment"
  >("dashboard");

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <ParentDashboard />;
      case "transport":
        return <ParentTransport />;
      case "assessment":
        return <ParentAssessmentHistory />;
      default:
        return <ParentDashboard />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Children</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "dashboard" && styles.activeTab]}
          onPress={() => setActiveTab("dashboard")}
          activeOpacity={0.7}
        >
          <View style={styles.tabIconContainer}>
            <Ionicons
              name="home"
              size={20}
              color={activeTab === "dashboard" ? "#fff" : "#666"}
            />
          </View>
          <Text
            style={[
              styles.tabText,
              activeTab === "dashboard" && styles.activeTabText,
            ]}
          >
            Dashboard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "transport" && styles.activeTab]}
          onPress={() => setActiveTab("transport")}
          activeOpacity={0.7}
        >
          <View style={styles.tabIconContainer}>
            <Ionicons
              name="bus"
              size={20}
              color={activeTab === "transport" ? "#fff" : "#666"}
            />
          </View>
          <Text
            style={[
              styles.tabText,
              activeTab === "transport" && styles.activeTabText,
            ]}
          >
            Transport
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "assessment" && styles.activeTab]}
          onPress={() => setActiveTab("assessment")}
          activeOpacity={0.7}
        >
          <View style={styles.tabIconContainer}>
            <Ionicons
              name="clipboard"
              size={20}
              color={activeTab === "assessment" ? "#fff" : "#666"}
            />
          </View>
          <Text
            style={[
              styles.tabText,
              activeTab === "assessment" && styles.activeTabText,
            ]}
          >
            Assessment
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>{renderContent()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: "#007AFF",
  },
  tabIconContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  tabText: {
    fontSize: 14,
    color: "#666",
  },
  activeTabText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
});
