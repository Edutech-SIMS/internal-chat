import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { getThemeColors } from "../themes";

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  class_level?: string;
  section?: string;
  profile_picture_url?: string;
  attendanceRate: number;
  totalDays: number;
  presentCount: number;
}

interface Assessment {
  id: string;
  subject: string;
  score: number;
  grade: string;
  date: string;
  type: string;
}

export default function ParentDashboard() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchParentStudents();
    }
  }, [user?.id, profile?.school_id]);

  const fetchParentStudents = async () => {
    try {
      // Optimized: Fetch students with nested assessment data in a single query
      const { data: parentLinks, error: linksError } = await supabase
        .from("parent_student_links")
        .select(`
          student_id,
          students!inner (
            id,
            student_id,
            first_name,
            last_name,
            class_level,
            profile_picture_url,
            assessment_results (
              id,
              marks_obtained,
              percentage,
              grade,
              created_at,
              assessment_types (
                name
              )
            ),
            attendance (
              status
            )
          )
        `)
        .eq("parent_user_id", user?.id)
        .eq("school_id", profile?.school_id)
        .order("created_at", { 
          foreignTable: "students.assessment_results", 
          ascending: false 
        })
        .limit(5, { foreignTable: "students.assessment_results" });

      if (linksError) throw linksError;

      if (!parentLinks || parentLinks.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      // Extract students and calculate attendance stats
      const studentsData = parentLinks
        .map((link: any) => {
          const student = link.students;
          if (!student) return null;

          const attendanceRecords = student.attendance || [];
          const totalDays = attendanceRecords.length;
          const presentCount = attendanceRecords.filter(
            (a: any) => a.status === "present"
          ).length;
          const attendanceRate = totalDays > 0 
            ? Math.round((presentCount / totalDays) * 100) 
            : 0;

          return {
            ...student,
            attendanceRate,
            totalDays,
            presentCount
          };
        })
        .filter(Boolean);

      setStudents(studentsData || []);

      // Select the first student by default
      if (studentsData.length > 0) {
        setSelectedStudentId(studentsData[0].id);
        // Extract assessments for the first student
        if (studentsData[0].assessment_results) {
          const transformedAssessments: Assessment[] = studentsData[0].assessment_results
            .slice(0, 5) // Take only first 5
            .map((assessment: any) => ({
              id: assessment.id,
              subject: assessment.assessment_types?.name || "Unknown Subject",
              score: assessment.marks_obtained || 0,
              grade: assessment.grade || "N/A",
              date: assessment.created_at,
              type: "Assessment",
            }));

          setAssessments(transformedAssessments);
        }
      }
    } catch (error) {
      console.error("Error fetching parent students:", error);
      Alert.alert("Error", "Failed to load student information");
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentAssessments = async (studentId: string) => {
    try {
      setSelectedStudentId(studentId);
      // Fetch actual assessment data from the database using the correct table
      const { data: assessmentsData, error } = await supabase
        .from("assessment_results")
        .select(
          `
          id,
          marks_obtained,
          percentage,
          grade,
          created_at,
          assessment_types(name)
        `
        )
        .eq("student_id", studentId)
        .eq("school_id", profile?.school_id)
        .order("created_at", { ascending: false })
        .limit(5); // Get only the 5 most recent assessments

      if (error) throw error;

      // Transform the data to match our Assessment interface
      const transformedAssessments: Assessment[] = (assessmentsData || []).map(
        (assessment) => ({
          id: assessment.id,
          subject:
            assessment.assessment_types &&
            assessment.assessment_types.length > 0
              ? assessment.assessment_types[0].name
              : "Unknown Subject",
              score: assessment.marks_obtained || 0,
          grade: assessment.grade || "N/A",
          date: assessment.created_at,
          type: "Assessment",
        })
      );

      setAssessments(transformedAssessments);
    } catch (error) {
      console.error("Error fetching assessments:", error);
      // Set empty array on error to avoid showing stale data
      setAssessments([]);
    }
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity
      style={[
        styles.studentCard, 
        { backgroundColor: colors.card },
        selectedStudentId === item.id && { 
          backgroundColor: isDarkMode ? '#1a2a3a' : '#f0f7ff'
        }
      ]}
      onPress={() => fetchStudentAssessments(item.id)}
    >
      <View style={[styles.studentAvatar, { backgroundColor: colors.border }]}>
        <Ionicons name="person" size={24} color={colors.placeholderText} />
      </View>
      <View style={styles.studentInfo}>
        <Text style={[styles.studentName, { color: colors.text }]}>
          {item.first_name} {item.last_name}
        </Text>
        <Text style={[styles.studentClass, { color: colors.placeholderText }]}>
          {item.class_level}
        </Text>
        <View style={styles.attendanceContainer}>
          <View style={styles.attendanceBadge}>
            <Ionicons name="stats-chart" size={12} color="#007AFF" />
            <Text style={styles.attendanceText}>{item.attendanceRate}% Attendance</Text>
          </View>
          <Text style={[styles.studentId, { color: colors.placeholderText, marginLeft: 8 }]}>
            ID: {item.student_id}
          </Text>
        </View>
      </View>
      {selectedStudentId === item.id && (
        <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
      )}
    </TouchableOpacity>
  );

  const renderAssessment = ({ item }: { item: Assessment }) => (
    <View style={[styles.assessmentItem, { backgroundColor: colors.card }]}>
      <View style={styles.assessmentHeader}>
        <Text style={[styles.subjectName, { color: colors.text }]}>{item.subject}</Text>
        <Text style={styles.assessmentType}>{item.type}</Text>
      </View>
      <View style={styles.assessmentDetails}>
        <Text style={[styles.score, { color: colors.placeholderText }]}>Score: {item.score}%</Text>
        <Text style={[styles.grade, getGradeStyle(item.grade)]}>
          {item.grade}
        </Text>
      </View>
      <Text style={[styles.date, { color: colors.placeholderText }]}>
        {new Date(item.date).toLocaleDateString()}
      </Text>
    </View>
  );

  const getGradeStyle = (grade: string) => {
    if (grade.includes("A")) return styles.gradeA;
    if (grade.includes("B")) return styles.gradeB;
    if (grade.includes("C")) return styles.gradeC;
    return styles.gradeD;
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View>
        <Text style={[styles.greeting, { color: colors.text }]}>
          Welcome back,
        </Text>
        <Text style={[styles.parentName, { color: colors.text }]}>
          {profile?.full_name || "Parent"}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.profileButton, { backgroundColor: colors.card }]}
      >
        <Ionicons name="person" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 10, color: colors.text }}>Loading parent dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}
      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 10 }]}>My Children</Text>

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={60} color={colors.placeholderText} />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No students linked to your account
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.placeholderText }]}>
            Contact school administration to link your children
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={students}
            keyExtractor={(item) => item.id}
            renderItem={renderStudent}
            style={styles.studentList}
          />

          {assessments.length > 0 && (
            <View style={styles.assessmentsSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Assessments</Text>
              <FlatList
                data={assessments}
                keyExtractor={(item) => item.id}
                renderItem={renderAssessment}
                horizontal
                showsHorizontalScrollIndicator={false}
              />
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
  parentName: {
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
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  studentList: {
    flex: 1,
  },
  studentCard: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  studentAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  studentClass: {
    fontSize: 14,
    marginBottom: 2,
  },
  studentId: {
    fontSize: 12,
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
  assessmentsSection: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },
  assessmentItem: {
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    width: 250,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  assessmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  subjectName: {
    fontSize: 16,
    fontWeight: "600",
  },
  assessmentType: {
    fontSize: 12,
    color: "#007AFF",
    backgroundColor: "#e6f0ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  assessmentDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  score: {
    fontSize: 14,
  },
  grade: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  gradeA: {
    color: "#28a745",
    backgroundColor: "#d4edda",
  },
  gradeB: {
    color: "#17a2b8",
    backgroundColor: "#d1ecf1",
  },
  gradeC: {
    color: "#ffc107",
    backgroundColor: "#fff3cd",
  },
  gradeD: {
    color: "#dc3545",
    backgroundColor: "#f8d7da",
  },
  date: {
    fontSize: 12,
  },
  attendanceContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  attendanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e6f0ff",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  attendanceText: {
    fontSize: 12,
    color: "#007AFF",
    marginLeft: 4,
    fontWeight: "500",
  },
});
