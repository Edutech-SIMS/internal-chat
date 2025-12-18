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
import AbsenceRequestModal from "./AbsenceRequestModal";
import { ThemedText as Text } from "./ThemedText";

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface AttendanceRecord {
  id: string;
  date: string;
  status: "present" | "absent" | "late" | "excused";
  notes?: string;
}

export default function ParentAttendance() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<
    AttendanceRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    total: 0,
  });
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchParentStudents();
    }
  }, [user?.id, profile?.school_id]);

  const fetchParentStudents = async () => {
    try {
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

      const { data: studentsData, error: studentsError } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .in("id", studentIds)
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      setStudents(studentsData || []);

      if (studentsData && studentsData.length > 0) {
        setSelectedStudent(studentsData[0].id);
        fetchAttendanceHistory(studentsData[0].id);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error("Error fetching students:", error);
      Alert.alert("Error", "Failed to load students");
      setLoading(false);
    }
  };

  const fetchAttendanceHistory = async (studentId: string) => {
    try {
      setLoading(true);

      console.log("Fetching attendance for student:", studentId);
      console.log("School ID:", profile?.school_id);

      const { data: attendanceData, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", studentId)
        .eq("school_id", profile?.school_id)
        .order("date", { ascending: false })
        .limit(30); // Last 30 records

      console.log("Attendance data received:", attendanceData);
      console.log("Attendance error:", error);

      if (error) throw error;

      setAttendanceHistory(attendanceData || []);
      calculateStats(attendanceData || []);
    } catch (error) {
      console.error("Error fetching attendance history:", error);
      Alert.alert("Error", "Failed to load attendance history");
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (records: AttendanceRecord[]) => {
    const newStats = {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      total: records.length,
    };
    records.forEach((record) => {
      if (record.status === "present") newStats.present++;
      else if (record.status === "absent") newStats.absent++;
      else if (record.status === "late") newStats.late++;
      else if (record.status === "excused") newStats.excused++;
    });
    setStats(newStats);
  };

  const handleStudentSelect = (studentId: string) => {
    setSelectedStudent(studentId);
    fetchAttendanceHistory(studentId);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "present":
        return "#28a745";
      case "absent":
        return "#dc3545";
      case "late":
        return "#ffc107";
      case "excused":
        return "#6c757d";
      default:
        return colors.primary;
    }
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

  const renderAttendanceRecord = ({ item }: { item: AttendanceRecord }) => (
    <View style={[styles.recordCard, { backgroundColor: colors.card }]}>
      <View style={styles.recordHeader}>
        <Text style={[styles.recordDate, { color: colors.text }]}>
          {new Date(item.date).toLocaleDateString(undefined, {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(item.status) + "20" },
          ]}
        >
          <Text
            style={[styles.statusText, { color: getStatusColor(item.status) }]}
          >
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      {item.notes && (
        <Text style={[styles.notesText, { color: colors.placeholderText }]}>
          {item.notes}
        </Text>
      )}
    </View>
  );

  if (loading && !selectedStudent) {
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.header, { color: colors.text, marginBottom: 0 }]}>
          Attendance History
        </Text>
        <TouchableOpacity
          style={[styles.requestButton, { backgroundColor: colors.primary }]}
          onPress={() => setShowAbsenceModal(true)}
        >
          <Ionicons name="add-circle-outline" size={20} color="white" />
          <Text style={styles.requestButtonText}>Request Absence</Text>
        </TouchableOpacity>
      </View>

      <AbsenceRequestModal
        visible={showAbsenceModal}
        onClose={() => setShowAbsenceModal(false)}
        students={students.map((s) => ({
          student_id: s.id,
          student_name: `${s.first_name} ${s.last_name}`,
        }))}
        onSuccess={() => {
          if (selectedStudent) {
            fetchAttendanceHistory(selectedStudent);
          }
        }}
      />

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="calendar-outline"
            size={60}
            color={colors.placeholderText}
          />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No students found
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.studentSelector}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Select Student
            </Text>
            <FlatList
              data={students}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              renderItem={renderStudent}
              contentContainerStyle={styles.studentListContent}
            />
          </View>

          {/* Stats Summary */}
          <View style={styles.statsContainer}>
            <View style={[styles.statCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: "#28a745" }]}>
                {stats.present}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Present
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: "#dc3545" }]}>
                {stats.absent}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Absent
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: "#ffc107" }]}>
                {stats.late}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.placeholderText }]}
              >
                Late
              </Text>
            </View>
          </View>

          <Text
            style={[styles.sectionTitle, { color: colors.text, marginTop: 16 }]}
          >
            Recent Records
          </Text>

          {loading ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              style={{ marginTop: 20 }}
            />
          ) : (
            <FlatList
              data={attendanceHistory}
              keyExtractor={(item) => item.id}
              renderItem={renderAttendanceRecord}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Text
                  style={[
                    styles.emptyText,
                    {
                      color: colors.placeholderText,
                      textAlign: "center",
                      marginTop: 20,
                    },
                  ]}
                >
                  No attendance records found
                </Text>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
  },
  requestButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  requestButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
  studentSelector: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  studentListContent: {
    paddingRight: 20,
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
    fontWeight: "500",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  listContent: {
    paddingBottom: 20,
  },
  recordCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  recordHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  recordDate: {
    fontSize: 16,
    fontWeight: "500",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  notesText: {
    fontSize: 14,
    marginTop: 8,
    fontStyle: "italic",
  },
});
