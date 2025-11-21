import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

export default function AttendanceScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="calendar" size={40} color="#007AFF" />
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.subtitle}>
            Track and manage student attendance
          </Text>
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Today&apos;s Attendance</Text>
            <Text style={styles.cardDescription}>
              Mark attendance for your classes today
            </Text>
            <View style={styles.placeholderContainer}>
              <Ionicons name="calendar-outline" size={60} color="#ccc" />
              <Text style={styles.placeholderText}>
                Attendance tracking feature coming soon
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Attendance Reports</Text>
            <Text style={styles.cardDescription}>
              View attendance reports and analytics
            </Text>
            <View style={styles.placeholderContainer}>
              <Ionicons name="bar-chart-outline" size={60} color="#ccc" />
              <Text style={styles.placeholderText}>
                Attendance reports coming soon
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
    alignItems: "center",
    marginBottom: 30,
    paddingTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    marginTop: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginTop: 5,
    textAlign: "center",
  },
  content: {
    flex: 1,
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
  cardTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  cardDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
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
  },
});
