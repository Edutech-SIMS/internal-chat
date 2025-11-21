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
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  class_level?: string;
  section?: string;
  profile_picture_url?: string;
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
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);

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
        .select(
          "id, student_id, first_name, last_name, class_level, section, profile_picture_url"
        )
        .in("id", studentIds)
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      setStudents(studentsData || []);

      // Fetch recent assessments for these students
      if (studentsData && studentsData.length > 0) {
        await fetchStudentAssessments(studentsData[0].id);
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
      style={styles.studentCard}
      onPress={() => fetchStudentAssessments(item.id)}
    >
      <View style={styles.studentAvatar}>
        <Ionicons name="person" size={24} color="#666" />
      </View>
      <View style={styles.studentInfo}>
        <Text style={styles.studentName}>
          {item.first_name} {item.last_name}
        </Text>
        <Text style={styles.studentClass}>
          {item.class_level} {item.section ? `- ${item.section}` : ""}
        </Text>
        <Text style={styles.studentId}>ID: {item.student_id}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  const renderAssessment = ({ item }: { item: Assessment }) => (
    <View style={styles.assessmentItem}>
      <View style={styles.assessmentHeader}>
        <Text style={styles.subjectName}>{item.subject}</Text>
        <Text style={styles.assessmentType}>{item.type}</Text>
      </View>
      <View style={styles.assessmentDetails}>
        <Text style={styles.score}>Score: {item.score}%</Text>
        <Text style={[styles.grade, getGradeStyle(item.grade)]}>
          {item.grade}
        </Text>
      </View>
      <Text style={styles.date}>
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

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading parent dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>My Children</Text>

      {students.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={60} color="#ccc" />
          <Text style={styles.emptyText}>
            No students linked to your account
          </Text>
          <Text style={styles.emptySubtext}>
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
              <Text style={styles.sectionTitle}>Recent Assessments</Text>
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
    backgroundColor: "#f8f9fa",
    padding: 16,
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 20,
  },
  studentList: {
    flex: 1,
  },
  studentCard: {
    flexDirection: "row",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  studentAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#f0f0f0",
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
    color: "#333",
    marginBottom: 4,
  },
  studentClass: {
    fontSize: 14,
    color: "#666",
    marginBottom: 2,
  },
  studentId: {
    fontSize: 12,
    color: "#999",
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
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  assessmentsSection: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  assessmentItem: {
    backgroundColor: "white",
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
    color: "#333",
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
    color: "#666",
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
    color: "#999",
  },
});
