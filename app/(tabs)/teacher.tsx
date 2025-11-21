import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  class_level?: string;
  section?: string;
  profile_picture_url?: string;
}

interface ClassInfo {
  id: string;
  name: string;
  subject: string;
}

export default function TeacherScreen() {
  const { user, profile } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayAttendance, setTodayAttendance] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchTeacherData();
    }
  }, [user?.id, profile?.school_id]);

  const fetchTeacherData = async () => {
    try {
      // Fetch teacher's assigned classes using the correct tables
      const { data: classesData, error: classesError } = await supabase
        .from("teacher_assignments")
        .select(
          `
          class_id,
          subjects(name),
          classes(class_name)
        `
        )
        .eq("teacher_id", user?.id)
        .eq("school_id", profile?.school_id)
        .limit(1); // Get first class for now

      if (classesError) throw classesError;

      let classInfo: ClassInfo | null = null;
      if (classesData && classesData.length > 0) {
        const classData = classesData[0];
        classInfo = {
          id: classData.class_id,
          name:
            classData.classes && classData.classes.length > 0
              ? classData.classes[0].class_name
              : "Unnamed Class",
          subject:
            classData.subjects && classData.subjects.length > 0
              ? classData.subjects[0].name
              : "General",
        };
        setClassInfo(classInfo);
      }

      // Fetch students in the class
      let studentsData: Student[] = [];
      if (classInfo) {
        const { data: classStudents, error: studentsError } = await supabase
          .from("enrollments")
          .select(
            `
            students(
              id,
              student_id,
              first_name,
              last_name,
              class_level,
              section,
              profile_picture_url
            )
          `
          )
          .eq("class_id", classInfo.id)
          .eq("school_id", profile?.school_id);

        if (studentsError) throw studentsError;

        studentsData = (classStudents || [])
          .map((cs: any) => cs.students)
          .filter(Boolean) as Student[];
      }

      setStudents(studentsData);
      setTotalStudents(studentsData.length);

      // Calculate today's attendance
      if (studentsData.length > 0 && classInfo) {
        const today = new Date().toISOString().split("T")[0];
        const { count: attendanceCount, error: attendanceError } =
          await supabase
            .from("attendance")
            .select("*", { count: "exact" })
            .eq("class_id", classInfo.id)
            .eq("date", today)
            .eq("status", "present");

        if (!attendanceError) {
          setTodayAttendance(attendanceCount || 0);
        } else {
          setTodayAttendance(0);
        }
      } else {
        setTodayAttendance(0);
      }
    } catch (error) {
      console.error("Error fetching teacher data:", error);
      Alert.alert("Error", "Failed to load class information");
    } finally {
      setLoading(false);
    }
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity style={styles.studentItem} activeOpacity={0.7}>
      <View style={styles.studentAvatar}>
        <Ionicons name="person" size={20} color="#fff" />
      </View>
      <View style={styles.studentInfo}>
        <Text style={styles.studentName} numberOfLines={1}>
          {item.first_name} {item.last_name}
        </Text>
        <Text style={styles.studentId}>ID: {item.student_id}</Text>
      </View>
      <TouchableOpacity style={styles.actionButton}>
        <Ionicons name="ellipsis-horizontal" size={20} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContainer}>
          <View style={styles.spinner} />
          <Text style={styles.loadingText}>Loading teacher dashboard...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Class</Text>
      </View>

      {classInfo && (
        <View style={styles.classInfoCard}>
          <View style={styles.cardHeader}>
            <View style={styles.iconContainer}>
              <Ionicons name="school" size={20} color="#fff" />
            </View>
            <View style={styles.classTextContainer}>
              <Text style={styles.className}>{classInfo.name}</Text>
              <Text style={styles.classSubject}>{classInfo.subject}</Text>
            </View>
          </View>

          <View style={styles.attendanceSummary}>
            <View style={styles.attendanceItem}>
              <Text style={styles.attendanceValue}>{todayAttendance}</Text>
              <Text style={styles.attendanceLabel}>Present</Text>
            </View>
            <View style={styles.attendanceItem}>
              <Text style={styles.attendanceValue}>
                {totalStudents - todayAttendance}
              </Text>
              <Text style={styles.attendanceLabel}>Absent</Text>
            </View>
            <View style={styles.attendanceItem}>
              <Text style={styles.attendanceValue}>{totalStudents}</Text>
              <Text style={styles.attendanceLabel}>Total</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderContent}>
            <Ionicons name="people-outline" size={20} color="#007AFF" />
            <Text style={styles.sectionTitle}>My Students</Text>
          </View>
          <TouchableOpacity>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        </View>

        {students.length > 0 ? (
          <FlatList
            data={students}
            keyExtractor={(item) => item.id}
            renderItem={renderStudent}
            scrollEnabled={false}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="person-outline" size={40} color="#007AFF" />
            <Text style={styles.emptyText}>No students in your class</Text>
          </View>
        )}
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: "#e6f0ff" }]}>
            <Ionicons name="calendar" size={20} color="#007AFF" />
          </View>
          <Text style={styles.actionText}>Take Attendance</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: "#e6f7ed" }]}>
            <Ionicons name="document-text" size={20} color="#28a745" />
          </View>
          <Text style={styles.actionText}>Record Assessment</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} activeOpacity={0.7}>
          <View style={[styles.actionIcon, { backgroundColor: "#fff8e6" }]}>
            <Ionicons name="chatbubble" size={20} color="#ffc107" />
          </View>
          <Text style={styles.actionText}>Message Parents</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "#007AFF",
    borderTopColor: "transparent",
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  header: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
  },
  classInfoCard: {
    backgroundColor: "white",
    margin: 16,
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
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  classTextContainer: {
    flex: 1,
  },
  className: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  classSubject: {
    fontSize: 16,
    color: "#666",
    marginTop: 2,
  },
  attendanceSummary: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 20,
  },
  attendanceItem: {
    alignItems: "center",
  },
  attendanceValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  attendanceLabel: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  section: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
  },
  viewAll: {
    fontSize: 14,
    color: "#007AFF",
  },
  studentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  studentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  studentId: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  actionButton: {
    padding: 8,
  },
  emptyContainer: {
    padding: 30,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
  },
  quickActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginHorizontal: 16,
    marginBottom: 16,
  },
  actionCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    width: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    color: "#333",
    marginTop: 8,
    textAlign: "center",
  },
});
