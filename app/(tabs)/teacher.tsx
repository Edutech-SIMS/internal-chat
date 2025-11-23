import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
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

interface ClassInfo {
  id: string;
  name: string;
  subject: string;
}

export default function TeacherScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

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

  const handleTakeAttendance = () => {
    router.push("/attendance");
  };

  const handleRecordAssessment = () => {
    Alert.alert("Coming Soon", "Assessment recording module is under development.");
  };

  const handleMessageParents = () => {
    router.push("/"); // Navigate to Chats tab
  };

  const fetchTeacherData = async () => {
    try {
      setLoading(true);
      
      // Step 1: Get teacher record
      const { data: teacherRecord, error: teacherError } = await supabase
        .from("teachers")
        .select("id, user_id")
        .eq("user_id", profile?.user_id)
        .single();

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

      // Step 2: Get class assignment using teacher_id
      const { data: assignment, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select(`
          assignment_id,
          class_id,
          classes!teacher_assignments_class_id_fkey!inner (
            class_id,
            name,
            grade_level,
            enrollments!enrollments_class_id_fkey!inner (
              id,
              status,
              students!enrollments_student_id_fkey!inner (
                id,
                student_id,
                first_name,
                last_name,
                profile_picture_url
              )
            )
          )
        `)
        .eq("teacher_id", teacherRecord.id)
        .eq("assignment_type", "class_teacher")
        .eq("status", "active")
        .maybeSingle();

      if (assignmentError) {
        console.error("Error fetching teacher assignment:", assignmentError);
        throw assignmentError;
      }

      if (assignment && assignment.classes) {
        const classData = assignment.classes as any;
        
        // Set class info
        setClassInfo({
          id: assignment.class_id,
          name: classData.name,
          subject: `Grade ${classData.grade_level} - Homeroom`,
        });

        // Process students
        if (classData.enrollments && classData.enrollments.length > 0) {
          const studentList = classData.enrollments
            .filter((e: any) => e.status === 'active')
            .map((e: any) => ({
              id: e.students.id,
              student_id: e.students.student_id,
              first_name: e.students.first_name,
              last_name: e.students.last_name,
              profile_picture_url: e.students.profile_picture_url,
              class_level: classData.grade_level
            }));
            
          setStudents(studentList);
          setTotalStudents(studentList.length);
          
          // Fetch today's attendance count
          const today = new Date().toISOString().split('T')[0];
          const { count, error: attendanceError } = await supabase
            .from('attendance')
            .select('*', { count: 'exact', head: true })
            .eq('class_id', assignment.class_id)
            .eq('date', today)
            .eq('status', 'present');
            
          if (!attendanceError) {
            setTodayAttendance(count || 0);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching teacher data:", error);
      Alert.alert("Error", "Failed to load class data");
    } finally {
      setLoading(false);
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View>
        <Text style={[styles.greeting, { color: colors.text }]}>
          Welcome back,
        </Text>
        <Text style={[styles.teacherName, { color: colors.text }]}>
          {profile?.full_name || "Teacher"}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.profileButton, { backgroundColor: colors.card }]}
      >
        <Ionicons name="person" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );

  const renderClassOverview = () => (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {classInfo?.name || "No Class Assigned"}
          </Text>
          <Text style={[styles.cardSubtitle, { color: colors.placeholderText }]}>
            {classInfo?.subject || "Contact admin for assignment"}
          </Text>
        </View>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.primary + "20" },
          ]}
        >
          <Ionicons name="school" size={24} color={colors.primary} />
        </View>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {totalStudents}
          </Text>
          <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
            Students
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {todayAttendance}
          </Text>
          <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
            Present Today
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
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
    </View>
  );

  const renderQuickActions = () => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Quick Actions
      </Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={handleTakeAttendance}
        >
          <View
            style={[styles.actionIcon, { backgroundColor: "#4CAF50" + "20" }]}
          >
            <Ionicons name="calendar" size={24} color="#4CAF50" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Take Attendance
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={handleRecordAssessment}
        >
          <View
            style={[styles.actionIcon, { backgroundColor: "#2196F3" + "20" }]}
          >
            <Ionicons name="create" size={24} color="#2196F3" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Record Assessment
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={handleMessageParents}
        >
          <View
            style={[styles.actionIcon, { backgroundColor: "#FF9800" + "20" }]}
          >
            <Ionicons name="chatbubbles" size={24} color="#FF9800" />
          </View>
          <Text style={[styles.actionText, { color: colors.text }]}>
            Message Parents
          </Text>
        </TouchableOpacity>
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
          <Text style={[styles.emptyStateText, { color: colors.placeholderText }]}>
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
              style={[
                styles.studentAvatar,
                { backgroundColor: colors.border },
              ]}
            >
              {student.profile_picture_url ? (
                // Use Image component here if URL exists
                <Ionicons name="person" size={20} color={colors.placeholderText} />
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
                style={[
                  styles.studentId,
                  { color: colors.placeholderText },
                ]}
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
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderHeader()}
        {renderClassOverview()}
        {renderQuickActions()}
        {renderStudentList()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 16,
    marginBottom: 4,
  },
  teacherName: {
    fontSize: 24,
    fontWeight: "bold",
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
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: "#E0E0E0",
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
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
  actionsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  studentItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
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
