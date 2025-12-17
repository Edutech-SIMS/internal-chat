import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  class_level?: string;
  section?: string;
  profile_picture_url?: string;
}

interface ClassAssignment {
  assignment_id: string;
  class_id: string;
  name: string;
  grade_level: string;
  students: Student[];
}

export default function TeacherScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [classAssignments, setClassAssignments] = useState<ClassAssignment[]>(
    []
  );
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayAttendance, setTodayAttendance] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showClassPicker, setShowClassPicker] = useState(false);

  // Computed values based on selected class
  const selectedClass = classAssignments.find(
    (c) => c.class_id === selectedClassId
  );
  const students = selectedClass?.students || [];
  const totalStudents = students.length;

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchTeacherData();
    }
  }, [user?.id, profile?.school_id]);

  const handleTakeAttendance = () => {
    router.push("/attendance");
  };

  const handleRecordAssessment = () => {
    Alert.alert(
      "Coming Soon",
      "Assessment recording module is under development."
    );
  };

  const handleMessageParents = () => {
    router.push("/"); // Navigate to Chats tab
  };

  const fetchTeacherData = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) setLoading(true);

      // Step 1: Get teacher record
      const { data: teacherRecord, error: teacherError } = await supabase
        .from("teachers")
        .select("id, user_id")
        .eq("user_id", profile?.user_id)
        .limit(1)
        .maybeSingle();

      if (teacherError) {
        console.log("Error fetching teacher record:", teacherError);
        setLoading(false);
        return;
      }

      if (!teacherRecord) {
        console.log("No teacher record found for user:", profile?.user_id);
        setLoading(false);
        return;
      }

      // Step 2: Get ALL class assignments for this teacher
      const { data: assignments, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select(
          `
          assignment_id,
          class_id,
          classes!teacher_assignments_class_id_fkey!inner (
            class_id,
            name,
            grade_level,
            enrollments!enrollments_class_id_fkey (
              id,
              status,
              students!enrollments_student_id_fkey (
                id,
                student_id,
                first_name,
                last_name,
                profile_picture_url
              )
            )
          )
        `
        )
        .eq("teacher_id", teacherRecord.id)
        .eq("assignment_type", "class_teacher")
        .eq("status", "active");

      if (assignmentError) {
        console.error("Error fetching teacher assignments:", assignmentError);
        throw assignmentError;
      }

      if (assignments && assignments.length > 0) {
        // Process all class assignments
        const processedAssignments: ClassAssignment[] = assignments.map(
          (assignment: any) => {
            const classData = assignment.classes;
            const studentList = (classData.enrollments || [])
              .filter((e: any) => e.status === "active" && e.students)
              .map((e: any) => ({
                id: e.students.id,
                student_id: e.students.student_id,
                first_name: e.students.first_name,
                last_name: e.students.last_name,
                profile_picture_url: e.students.profile_picture_url,
                class_level: classData.grade_level,
              }));

            return {
              assignment_id: assignment.assignment_id,
              class_id: assignment.class_id,
              name: classData.name,
              grade_level: classData.grade_level,
              students: studentList,
            };
          }
        );

        setClassAssignments(processedAssignments);

        // Auto-select first class if none selected
        if (!selectedClassId && processedAssignments.length > 0) {
          setSelectedClassId(processedAssignments[0].class_id);
        }

        // Fetch today's attendance for the selected class
        const classToCheck =
          selectedClassId || processedAssignments[0].class_id;
        const today = new Date().toISOString().split("T")[0];
        const { count, error: attendanceError } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("class_id", classToCheck)
          .eq("date", today)
          .eq("status", "present");

        if (!attendanceError) {
          setTodayAttendance(count || 0);
        }
      } else {
        setClassAssignments([]);
      }
    } catch (error) {
      console.error("Error fetching teacher data:", error);
      Alert.alert("Error", "Failed to load class data");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTeacherData(true);
    setRefreshing(false);
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View>
        <Text style={[styles.greeting, { color: colors.text }]}>
          Welcome back,
        </Text>
        <Text style={[styles.teacherName, { color: colors.text }]}>
          {profile?.full_name || "Teacher"}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, color: colors.text, fontWeight: "600" }}>
          {new Date().toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
        </Text>
        <View
          style={{
            backgroundColor: colors.primary + "20",
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 4,
            marginTop: 4,
          }}
        >
          <Text
            style={{ fontSize: 11, color: colors.primary, fontWeight: "700" }}
          >
            Term 1
          </Text>
        </View>
      </View>
    </View>
  );

  const renderClassSelector = () => {
    if (classAssignments.length === 0) return null;

    if (classAssignments.length === 1) {
      return (
        <View style={styles.section}>
          <View
            style={[
              styles.singleClassCard,
              {
                backgroundColor: colors.primary + "10",
                borderColor: colors.primary + "30",
              },
            ]}
          >
            <View style={styles.singleClassIcon}>
              <Ionicons name="people" size={24} color={colors.primary} />
            </View>
            <View>
              <Text style={[styles.singleClassTitle, { color: colors.text }]}>
                {classAssignments[0].name}
              </Text>
              <Text
                style={[
                  styles.singleClassSubtitle,
                  { color: colors.placeholderText },
                ]}
              >
                {classAssignments[0].students.length} Students Enrolled
              </Text>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: colors.text, fontSize: 18 }]}
        >
          Select Class
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12 }}
        >
          {classAssignments.map((assignment) => {
            const isSelected = selectedClassId === assignment.class_id;
            return (
              <TouchableOpacity
                key={assignment.class_id}
                style={[
                  styles.classCard,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.card,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setSelectedClassId(assignment.class_id);
                  fetchAttendanceForClass(assignment.class_id);
                }}
              >
                <View style={styles.classCardContent}>
                  <Ionicons
                    name="school"
                    size={20}
                    color={isSelected ? "white" : colors.primary}
                  />
                  <View>
                    <Text
                      style={[
                        styles.classCardTitle,
                        { color: isSelected ? "white" : colors.text },
                      ]}
                    >
                      {assignment.name}
                    </Text>
                    <Text
                      style={[
                        styles.classCardSubtitle,
                        {
                          color: isSelected
                            ? "rgba(255,255,255,0.8)"
                            : colors.placeholderText,
                        },
                      ]}
                    >
                      {assignment.students.length} Students
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const fetchAttendanceForClass = async (classId: string) => {
    const today = new Date().toISOString().split("T")[0];
    const { count, error } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("date", today)
      .eq("status", "present");

    if (!error) {
      setTodayAttendance(count || 0);
    }
  };

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#e3f2fd" }]}>
          <Ionicons name="people" size={24} color="#007AFF" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {totalStudents}
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Students
        </Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#e8f5e9" }]}>
          <Ionicons name="checkmark-circle" size={24} color="#28a745" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {todayAttendance}
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Present
        </Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card }]}>
        <View style={[styles.statIcon, { backgroundColor: "#fff3e0" }]}>
          <Ionicons name="pie-chart" size={24} color="#ff9800" />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>
          {totalStudents > 0
            ? Math.round((todayAttendance / totalStudents) * 100)
            : 0}
          %
        </Text>
        <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
          Attendance
        </Text>
      </View>
    </View>
  );

  const renderStudentList = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          My Students
        </Text>
      </View>

      {students.length === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Text
            style={[styles.emptyStateText, { color: colors.placeholderText }]}
          >
            No students found in your class.
          </Text>
        </View>
      ) : (
        students.map((student) => (
          <View
            key={student.id}
            style={[styles.studentItem, { backgroundColor: colors.card }]}
          >
            <View
              style={[styles.studentAvatar, { backgroundColor: colors.border }]}
            >
              {student.profile_picture_url ? (
                <Image
                  source={{ uri: student.profile_picture_url }}
                  style={{ width: 40, height: 40, borderRadius: 20 }}
                />
              ) : (
                <Text style={[styles.avatarText, { color: colors.text }]}>
                  {student.first_name[0]}
                  {student.last_name[0]}
                </Text>
              )}
            </View>
            <View style={styles.studentInfo}>
              <Text style={[styles.studentName, { color: colors.text }]}>
                {student.first_name} {student.last_name}
              </Text>
              <Text
                style={[styles.studentId, { color: colors.placeholderText }]}
              >
                ID: {student.student_id}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading class data...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {renderHeader()}
        {renderClassSelector()}
        {renderStats()}

        {renderStudentList()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 16,
    opacity: 0.7,
  },
  teacherName: {
    fontSize: 24,
    fontWeight: "bold",
  },
  className: {
    fontSize: 14,
    marginLeft: 6,
  },
  classIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    marginHorizontal: 4,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },
  classCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 160,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  classCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  classCardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  classCardSubtitle: {
    fontSize: 12,
  },
  singleClassCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
  },
  singleClassIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  singleClassTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 2,
  },
  singleClassSubtitle: {
    fontSize: 13,
  },

  studentItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  studentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  studentId: {
    fontSize: 12,
  },
  emptyState: {
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
  },
});
