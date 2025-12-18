import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { getThemeColors } from "../themes";
import { ThemedText as Text } from "./ThemedText";

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface TransportInfo {
  route_name: string;
  driver_name: string;
  driver_phone: string;
  vehicle_number: string;
  pickup_time: string;
  dropoff_time: string;
  pickup_location: string;
  dropoff_location: string;
}

export default function ParentTransport() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [transportInfo, setTransportInfo] = useState<TransportInfo | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchParentStudents();
    }
  }, [user?.id, profile?.school_id]);

  const fetchParentStudents = async () => {
    try {
      // Fetch students linked to this parent
      const { data: links, error: linksError } = await supabase
        .from("parent_student_links")
        .select("student_id")
        .eq("parent_user_id", user?.id)
        .eq("school_id", profile?.school_id);

      if (linksError) throw linksError;

      if (!links || links.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const studentIds = links.map((link: any) => link.student_id);

      // Fetch student details
      const { data: studentsData, error: studentsError } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .in("id", studentIds)
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      setStudents(studentsData || []);

      // Auto-select first student if available
      if (studentsData && studentsData.length > 0) {
        setSelectedStudent(studentsData[0].id);
        fetchTransportInfo(studentsData[0].id);
      }
    } catch (error) {
      console.error("Error fetching parent students:", error);
      Alert.alert("Error", "Failed to load student information");
    } finally {
      setLoading(false);
    }
  };

  const fetchTransportInfo = async (studentId: string) => {
    try {
      // Fetch actual transport data from the database using the correct tables
      const { data: transportData, error } = await supabase
        .from("transport_student_assignments")
        .select(
          `
          pickup_route_id,
          dropoff_route_id,
          pickup_description,
          dropoff_description,
          pickup_route:transport_routes!pickup_route_id(name),
          dropoff_route:transport_routes!dropoff_route_id(name)
        `
        )
        .eq("student_id", studentId)
        .eq("school_id", profile?.school_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (transportData) {
        // Transform the data to match our TransportInfo interface
        const pickupRoute = transportData.pickup_route as any;
        const dropoffRoute = transportData.dropoff_route as any;

        const transportInfo: TransportInfo = {
          route_name: pickupRoute?.name || "No Route Assigned",
          driver_name: "Driver information not available", // This would require joining with driver tables
          driver_phone: "Contact information not available",
          vehicle_number: "Vehicle information not available",
          pickup_time: "07:30 AM", // This would need to come from route schedule
          dropoff_time: "03:45 PM", // This would need to come from route schedule
          pickup_location:
            transportData.pickup_description || "Pickup location not specified",
          dropoff_location:
            transportData.dropoff_description ||
            "Dropoff location not specified",
        };

        setTransportInfo(transportInfo);
      } else {
        setTransportInfo(null);
      }
    } catch (error) {
      console.error("Error fetching transport info:", error);
      setTransportInfo(null);
    }
  };

  const handleStudentSelect = (studentId: string) => {
    setSelectedStudent(studentId);
    fetchTransportInfo(studentId);
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity
      style={[
        styles.studentItem,
        { backgroundColor: colors.card, borderColor: colors.border },
        selectedStudent === item.id && {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
      ]}
      onPress={() => handleStudentSelect(item.id)}
    >
      <Text
        style={[
          styles.studentName,
          { color: colors.text },
          selectedStudent === item.id && { color: "#fff" },
        ]}
      >
        {item.first_name} {item.last_name}
      </Text>
    </TouchableOpacity>
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
        <Text style={{ marginTop: 10, color: colors.text }}>
          Loading transport information...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.text }]}>
        Transport Information
      </Text>

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="bus-outline"
            size={60}
            color={colors.placeholderText}
          />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No students linked to your account
          </Text>
          <Text
            style={[styles.emptySubtext, { color: colors.placeholderText }]}
          >
            Contact school administration to link your children
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.studentSelector}>
            <Text style={[styles.selectorLabel, { color: colors.text }]}>
              Select Student:
            </Text>
            <FlatList
              data={students}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              renderItem={renderStudent}
            />
          </View>

          {transportInfo ? (
            <View
              style={[styles.transportCard, { backgroundColor: colors.card }]}
            >
              <View style={styles.cardHeader}>
                <Ionicons name="bus" size={24} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {transportInfo.route_name}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons
                  name="person"
                  size={20}
                  color={colors.placeholderText}
                />
                <View style={styles.infoTextContainer}>
                  <Text
                    style={[
                      styles.infoLabel,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Driver
                  </Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {transportInfo.driver_name}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Ionicons
                  name="call"
                  size={20}
                  color={colors.placeholderText}
                />
                <View style={styles.infoTextContainer}>
                  <Text
                    style={[
                      styles.infoLabel,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Contact
                  </Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {transportInfo.driver_phone}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="car" size={20} color={colors.placeholderText} />
                <View style={styles.infoTextContainer}>
                  <Text
                    style={[
                      styles.infoLabel,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Vehicle
                  </Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {transportInfo.vehicle_number}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.timeContainer,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.timeItem}>
                  <Text
                    style={[
                      styles.timeLabel,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Pickup
                  </Text>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {transportInfo.pickup_time}
                  </Text>
                  <Text
                    style={[styles.location, { color: colors.placeholderText }]}
                  >
                    {transportInfo.pickup_location}
                  </Text>
                </View>
                <View style={styles.timeSeparator}>
                  <Ionicons
                    name="arrow-forward"
                    size={20}
                    color={colors.placeholderText}
                  />
                </View>
                <View style={styles.timeItem}>
                  <Text
                    style={[
                      styles.timeLabel,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Dropoff
                  </Text>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {transportInfo.dropoff_time}
                  </Text>
                  <Text
                    style={[styles.location, { color: colors.placeholderText }]}
                  >
                    {transportInfo.dropoff_location}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.noTransportContainer}>
              <Ionicons
                name="information-circle-outline"
                size={40}
                color={colors.primary}
              />
              <Text
                style={[
                  styles.noTransportText,
                  { color: colors.placeholderText },
                ]}
              >
                No transport information available for this student
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  studentSelector: {
    marginBottom: 20,
  },
  selectorLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
  },
  studentItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  studentName: {
    fontSize: 14,
  },
  transportCard: {
    borderRadius: 12,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  infoTextContainer: {
    marginLeft: 15,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "500",
  },
  timeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
  },
  timeItem: {
    alignItems: "center",
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    marginBottom: 5,
  },
  timeValue: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 5,
  },
  location: {
    fontSize: 14,
  },
  timeSeparator: {
    marginHorizontal: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
  noTransportContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  noTransportText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 16,
  },
});
