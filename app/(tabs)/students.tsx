import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

export default function StudentsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="person" size={40} color="#007AFF" />
          <Text style={styles.title}>Student Information</Text>
          <Text style={styles.subtitle}>Manage and view student records</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Student Directory</Text>
            <Text style={styles.cardDescription}>
              View and search all student records
            </Text>
            <View style={styles.placeholderContainer}>
              <Ionicons name="people-outline" size={60} color="#ccc" />
              <Text style={styles.placeholderText}>
                Student directory feature coming soon
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add New Student</Text>
            <Text style={styles.cardDescription}>
              Register new students in the system
            </Text>
            <View style={styles.placeholderContainer}>
              <Ionicons name="person-add-outline" size={60} color="#ccc" />
              <Text style={styles.placeholderText}>
                Student registration feature coming soon
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Student Reports</Text>
            <Text style={styles.cardDescription}>
              Generate reports on student performance and information
            </Text>
            <View style={styles.placeholderContainer}>
              <Ionicons name="document-text-outline" size={60} color="#ccc" />
              <Text style={styles.placeholderText}>
                Student reports feature coming soon
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
