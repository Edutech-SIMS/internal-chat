
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
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
  first_name: string;
  last_name: string;
}

interface Assessment {
  id: string;
  subject: string;
  score: number;
  grade: string;
  date: string;
  type: string;
  max_score: number;
  percentage: number;
  teacher: string;
}

interface SubjectAverage {
  subject: string;
  average: number;
  grade: string;
}

export default function ParentAssessmentHistory() {
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [subjectAverages, setSubjectAverages] = useState<SubjectAverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"term" | "session">("term");

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
        fetchAssessmentData(studentsData[0].id);
      }
    } catch (error) {
      console.error("Error fetching parent students:", error);
      Alert.alert("Error", "Failed to load student information");
    } finally {
      setLoading(false);
    }
  };

  const fetchAssessmentData = async (studentId: string) => {
    try {
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
        .order("created_at", { ascending: false });

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
          max_score: 100, // Default max score
          percentage: assessment.percentage || 0,
          teacher: "Teacher information not available", // Would require joining with teacher tables
        })
      );

      setAssessments(transformedAssessments);

      // Calculate subject averages
      const subjectMap: Record<string, { total: number; count: number }> = {};

      transformedAssessments.forEach((assessment) => {
        if (!subjectMap[assessment.subject]) {
          subjectMap[assessment.subject] = { total: 0, count: 0 };
        }
        subjectMap[assessment.subject].total += assessment.percentage;
        subjectMap[assessment.subject].count += 1;
      });

      const averages: SubjectAverage[] = Object.keys(subjectMap).map(
        (subject) => {
          const avg = subjectMap[subject].total / subjectMap[subject].count;
          let grade = "F";
          if (avg >= 90) grade = "A+";
          else if (avg >= 85) grade = "A";
          else if (avg >= 80) grade = "A-";
          else if (avg >= 75) grade = "B+";
          else if (avg >= 70) grade = "B";
          else if (avg >= 65) grade = "B-";
          else if (avg >= 60) grade = "C+";
          else if (avg >= 55) grade = "C";
          else if (avg >= 50) grade = "C-";
          else if (avg >= 45) grade = "D+";
          else if (avg >= 40) grade = "D";
          else grade = "F";

          return {
            subject,
            average: parseFloat(avg.toFixed(1)),
            grade,
          };
        }
      );

      setSubjectAverages(averages);
    } catch (error) {
      console.error("Error fetching assessment data:", error);
      setAssessments([]);
      setSubjectAverages([]);
    }
  };

  const handleStudentSelect = (studentId: string) => {
    setSelectedStudent(studentId);
    fetchAssessmentData(studentId);
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity
      style={[
        styles.studentItem,
        { backgroundColor: colors.card, borderColor: colors.border },
        selectedStudent === item.id && { backgroundColor: colors.primary, borderColor: colors.primary },
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

  const renderAssessment = ({ item }: { item: Assessment }) => (
    <View style={[styles.assessmentItem, { backgroundColor: colors.card }]}>
      <View style={styles.assessmentHeader}>
        <Text style={[styles.subjectName, { color: colors.text }]}>{item.subject}</Text>
        <Text style={styles.assessmentType}>{item.type}</Text>
      </View>
      <View style={styles.assessmentDetails}>
        <Text style={[styles.score, { color: colors.placeholderText }]}>
          Score: {item.score}/{item.max_score}
        </Text>
        <Text style={[styles.grade, getGradeStyle(item.grade)]}>
          {item.grade}
        </Text>
      </View>
      <View style={styles.assessmentFooter}>
        <Text style={[styles.teacher, { color: colors.placeholderText }]}>By {item.teacher}</Text>
        <Text style={[styles.date, { color: colors.placeholderText }]}>
          {new Date(item.date).toLocaleDateString()}
        </Text>
      </View>
    </View>
  );

  const renderSubjectAverage = ({ item }: { item: SubjectAverage }) => (
    <View style={[styles.averageItem, { backgroundColor: colors.card }]}>
      <Text style={[styles.subjectAverageName, { color: colors.text }]}>{item.subject}</Text>
      <Text style={[styles.averageValue, { color: colors.primary }]}>{item.average}%</Text>
      <Text style={[styles.averageGrade, getGradeStyle(item.grade)]}>
        {item.grade}
      </Text>
    </View>
  );

  const getGradeStyle = (grade: string) => {
    if (grade.includes("A")) return styles.gradeA;
    if (grade.includes("B")) return styles.gradeB;
    if (grade.includes("C")) return styles.gradeC;
    return styles.gradeD;
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 10, color: colors.text }}>Loading assessment history...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.text }]}>Assessment History</Text>

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="clipboard-outline" size={60} color={colors.placeholderText} />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No students linked to your account
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.placeholderText }]}>
            Contact school administration to link your children
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.studentSelector}>
            <Text style={[styles.selectorLabel, { color: colors.text }]}>Select Student:</Text>
            <FlatList
              data={students}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              renderItem={renderStudent}
            />
          </View>

          <View style={[styles.timeRangeSelector, { backgroundColor: isDarkMode ? colors.card : "#e9ecef" }]}>
            <TouchableOpacity
              style={[
                styles.timeButton,
                timeRange === "term" && { backgroundColor: colors.background },
              ]}
              onPress={() => setTimeRange("term")}
            >
              <Text
                style={[
                  styles.timeButtonText,
                  { color: colors.placeholderText },
                  timeRange === "term" && { color: colors.primary, fontWeight: "600" },
                ]}
              >
                This Term
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.timeButton,
                timeRange === "session" && { backgroundColor: colors.background },
              ]}
              onPress={() => setTimeRange("session")}
            >
              <Text
                style={[
                  styles.timeButtonText,
                  { color: colors.placeholderText },
                  timeRange === "session" && { color: colors.primary, fontWeight: "600" },
                ]}
              >
                This Session
              </Text>
            </TouchableOpacity>
          </View>

          {subjectAverages.length > 0 && (
            <View style={styles.averagesSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Subject Averages</Text>
              <FlatList
                data={subjectAverages}
                keyExtractor={(item) => item.subject}
                renderItem={renderSubjectAverage}
                horizontal
                showsHorizontalScrollIndicator={false}
              />
            </View>
          )}

          {assessments.length > 0 ? (
            <View style={styles.assessmentsSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Assessments</Text>
              <FlatList
                data={assessments}
                keyExtractor={(item) => item.id}
                renderItem={renderAssessment}
                scrollEnabled={false}
              />
            </View>
          ) : (
            <View style={styles.noAssessmentsContainer}>
              <Ionicons
                name="information-circle-outline"
                size={40}
                color={colors.primary}
              />
              <Text style={[styles.noAssessmentsText, { color: colors.placeholderText }]}>
                No assessment records found for this student
              </Text>
            </View>
          )}
        </ScrollView>
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
  timeRangeSelector: {
    flexDirection: "row",
    marginBottom: 20,
    borderRadius: 20,
    padding: 4,
  },
  timeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 16,
  },
  activeTimeButton: {
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  timeButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  activeTimeButtonText: {
    fontWeight: "600",
  },
  averagesSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },
  averageItem: {
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    width: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    alignItems: "center",
  },
  subjectAverageName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  averageValue: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  averageGrade: {
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
  assessmentsSection: {
    marginBottom: 20,
  },
  assessmentItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
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
  assessmentFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  teacher: {
    fontSize: 12,
  },
  date: {
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
  noAssessmentsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  noAssessmentsText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 16,
  },
});
