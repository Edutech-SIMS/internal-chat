import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

export default function AttendanceScreen() {
  const { hasRole, user, profile } = useAuth();
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isParent = hasRole("parent");
  const isTeacher = hasRole("teacher");
  const isAdmin = hasRole("admin") || hasRole("superadmin");

  useEffect(() => {
    loadAttendanceData();
  }, [isParent, isTeacher, isAdmin]);

  const loadAttendanceData = async () => {
    setLoading(true);
    try {
      if (isParent && profile?.id) {
        // For parents, fetch attendance for their children
        const { data, error } = await supabase
          .from("parent_student_links")
          .select(
            `
            students (
              id,
              full_name,
              student_attendance (
                date,
                status,
                remark
              )
            )
          `
          )
          .eq("parent_id", profile.id)
          .eq("school_id", profile.school_id);

        if (error) throw error;

        const attendance =
          data?.flatMap(
            (link: any) =>
              link.students?.student_attendance?.map((att: any) => ({
                student_name: link.students.full_name,
                date: att.date,
                status: att.status,
                remark: att.remark,
              })) || []
          ) || [];

        setAttendanceData(attendance);
      } else if (isTeacher && user?.id) {
        // For teachers, fetch attendance for their classes
        const { data, error } = await supabase
          .from("teacher_assignments")
          .select(
            `
            classes (
              id,
              class_name,
              class_students (
                students (
                  full_name
                )
              )
            ),
            subjects (
              name
            )
          `
          )
          .eq("teacher_id", user.id)
          .eq("school_id", profile?.school_id);

        if (error) throw error;

        // Simplified data structure for display
        const attendance =
          data?.map((assignment: any) => ({
            class_name: assignment.classes?.class_name || "Unknown Class",
            subject: assignment.subjects?.name || "General",
            student_count: assignment.classes?.class_students?.length || 0,
          })) || [];

        setAttendanceData(attendance);
      } else if (isAdmin) {
        // For admins, fetch overall attendance statistics
        const { data, error } = await supabase
          .from("student_attendance")
          .select("status, count", { count: "exact" })
          .eq("school_id", profile?.school_id);

        if (error) throw error;

        // Group data by status manually
        const groupedData: any = {};
        data?.forEach((item: any) => {
          if (!groupedData[item.status]) {
            groupedData[item.status] = 0;
          }
          groupedData[item.status] += item.count;
        });

        const groupedArray = Object.keys(groupedData).map((status) => ({
          status,
          count: groupedData[status],
        }));

        setAttendanceData(groupedArray);
      }
    } catch (error) {
      console.error("Error loading attendance data:", error);
    } finally {
      setLoading(false);
    }
  };

  const renderParentContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="calendar" size={32} color="#fff" />
        </View>
        <Text style={styles.title}>Children{`'`}s Attendance</Text>
        <Text style={styles.subtitle}>
          View attendance records for your children
        </Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderText}>
              Loading attendance data...
            </Text>
          </View>
        ) : attendanceData.length > 0 ? (
          attendanceData.map((record: any, index: number) => (
            <View key={index} style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="person-outline" size={24} color="#007AFF" />
                <Text style={styles.cardTitle}>{record.student_name}</Text>
              </View>
              <View style={styles.attendanceRow}>
                <Text style={styles.attendanceDate}>{record.date}</Text>
                <Text
                  style={[
                    styles.attendanceStatus,
                    record.status === "present"
                      ? styles.present
                      : record.status === "absent"
                      ? styles.absent
                      : styles.late,
                  ]}
                >
                  {record.status?.charAt(0).toUpperCase() +
                    record.status?.slice(1)}
                </Text>
              </View>
              {record.remark && (
                <Text style={styles.attendanceRemark}>{record.remark}</Text>
              )}
            </View>
          ))
        ) : (
          <View style={styles.card}>
            <View style={styles.placeholderContainer}>
              <Ionicons name="calendar-outline" size={60} color="#007AFF" />
              <Text style={styles.placeholderText}>
                No attendance records found for your children
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );

  const renderTeacherContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="calendar" size={32} color="#fff" />
        </View>
        <Text style={styles.title}>Class Attendance</Text>
        <Text style={styles.subtitle}>
          Track and manage student attendance for your classes
        </Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderText}>Loading class data...</Text>
          </View>
        ) : attendanceData.length > 0 ? (
          attendanceData.map((classData: any, index: number) => (
            <View key={index} style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="school-outline" size={24} color="#007AFF" />
                <Text style={styles.cardTitle}>{classData.class_name}</Text>
              </View>
              <Text style={styles.cardDescription}>
                Subject: {classData.subject}
              </Text>
              <Text style={styles.cardDescription}>
                Students: {classData.student_count}
              </Text>
              <View style={styles.actionButton}>
                <Text style={styles.buttonText}>Take Attendance</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.card}>
            <View style={styles.placeholderContainer}>
              <Ionicons name="school-outline" size={60} color="#007AFF" />
              <Text style={styles.placeholderText}>
                You don{`'`}t have any classes assigned yet
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );

  const renderAdminContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="calendar" size={32} color="#fff" />
        </View>
        <Text style={styles.title}>Attendance Management</Text>
        <Text style={styles.subtitle}>Full attendance management system</Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderText}>
              Loading attendance statistics...
            </Text>
          </View>
        ) : attendanceData.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="bar-chart-outline" size={24} color="#007AFF" />
              <Text style={styles.cardTitle}>Attendance Statistics</Text>
            </View>
            {attendanceData.map((stat: any, index: number) => (
              <View key={index} style={styles.statRow}>
                <Text style={styles.statLabel}>{stat.status}:</Text>
                <Text style={styles.statValue}>{stat.count}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.placeholderContainer}>
              <Ionicons name="bar-chart-outline" size={60} color="#007AFF" />
              <Text style={styles.placeholderText}>
                No attendance data available
              </Text>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="settings-outline" size={24} color="#007AFF" />
            <Text style={styles.cardTitle}>Attendance Reports</Text>
          </View>
          <Text style={styles.cardDescription}>
            Generate detailed attendance reports
          </Text>
          <View style={styles.actionButton}>
            <Text style={styles.buttonText}>Generate Report</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderDefaultContent = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="calendar" size={32} color="#fff" />
        </View>
        <Text style={styles.title}>Attendance</Text>
        <Text style={styles.subtitle}>Track and manage student attendance</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="calendar-outline" size={24} color="#007AFF" />
            <Text style={styles.cardTitle}>Today{`'`}s Attendance</Text>
          </View>
          <Text style={styles.cardDescription}>
            Mark attendance for your classes today
          </Text>
          <View style={styles.placeholderContainer}>
            <Ionicons name="calendar-outline" size={60} color="#007AFF" />
            <Text style={styles.placeholderText}>
              Attendance tracking feature coming soon
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="bar-chart-outline" size={24} color="#007AFF" />
            <Text style={styles.cardTitle}>Attendance Reports</Text>
          </View>
          <Text style={styles.cardDescription}>
            View attendance reports and analytics
          </Text>
          <View style={styles.placeholderContainer}>
            <Ionicons name="bar-chart-outline" size={60} color="#007AFF" />
            <Text style={styles.placeholderText}>
              Attendance reports coming soon
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderContent = () => {
    if (isParent) {
      return renderParentContent();
    } else if (isTeacher) {
      return renderTeacherContent();
    } else if (isAdmin) {
      return renderAdminContent();
    } else {
      return renderDefaultContent();
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {renderContent()}
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
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
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
    marginBottom: 20,
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginLeft: 10,
  },
  cardDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    lineHeight: 20,
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
    lineHeight: 22,
  },
  attendanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  attendanceDate: {
    fontSize: 14,
    color: "#666",
  },
  attendanceStatus: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  present: {
    backgroundColor: "#e8f5e9",
    color: "#4caf50",
  },
  absent: {
    backgroundColor: "#ffebee",
    color: "#f44336",
  },
  late: {
    backgroundColor: "#fff3e0",
    color: "#ff9800",
  },
  attendanceRemark: {
    fontSize: 12,
    color: "#999",
    marginTop: 5,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  statLabel: {
    fontSize: 16,
    color: "#666",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  actionButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 15,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
