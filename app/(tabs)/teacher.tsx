import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatCard } from "../../components/StatCard";
import { ThemedText as Text } from "../../components/ThemedText";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  date_of_birth?: string;
  gender?: string;
  class_level?: string;
  section?: string;
  admission_date: string;
  address?: string;
  medical_conditions?: string;
  status: string;
  enrollment_status: string;
  profile_picture_url?: string;
  nationality?: string;
  school_id?: string;
  session_id?: string;
  term_id?: string;
  class_id?: string;
}

interface ClassAssignment {
  assignment_id: string;
  class_id: string;
  name: string;
  grade_level: string;
  students: Student[];
}

interface ParentLink {
  id: string;
  relationship: string;
  parent_user_id: string;
  profile?: {
    user_id: string;
    full_name: string;
    email: string;
    mobile_number?: string;
  } | null;
}

interface EmergencyContact {
  id: string;
  contact_name: string;
  relationship: string;
  phone_primary: string;
  phone_secondary?: string;
}

interface Enrollment {
  id: string;
  class_level: string;
  academic_year: string;
  enrollment_date: string;
  status: string;
}

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  class_id: string;
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
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<
    EmergencyContact[]
  >([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>(
    []
  );
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const selectedClass = classAssignments.find(
    (c) => c.class_id === selectedClassId
  );
  const students = selectedClass?.students || [];

  useEffect(() => {
    if (user?.id && profile?.school_id) {
      fetchTeacherData();
    }
  }, [user?.id, profile?.school_id]);

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
        console.error("Error fetching teacher record:", teacherError);
        setLoading(false);
        return;
      }

      if (!teacherRecord) {
        console.log("No teacher record found for user:", profile?.user_id);
        setLoading(false);
        return;
      }

      // Step 2: Get class assignments
      const { data: assignments, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select(
          `
          assignment_id,
          class_id,
          classes!teacher_assignments_class_id_fkey (
            class_id,
            name,
            grade_level
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
        // Step 3: Get students for each class
        const classIds = assignments.map((a: any) => a.class_id);

        const { data: studentsData, error: studentsError } = await supabase
          .from("students")
          .select("*")
          .in("class_id", classIds)
          .eq("status", "active")
          .eq("enrollment_status", "enrolled");

        if (studentsError) {
          console.error("Error fetching students:", studentsError);
          throw studentsError;
        }

        // Process class assignments with students
        const processedAssignments: ClassAssignment[] = assignments.map(
          (assignment: any) => {
            const classData = assignment.classes;
            const classStudents = (studentsData || []).filter(
              (s: Student) => s.class_id === assignment.class_id
            );

            return {
              assignment_id: assignment.assignment_id,
              class_id: assignment.class_id,
              name: classData.name,
              grade_level: classData.grade_level,
              students: classStudents,
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
        await fetchAttendanceForClass(classToCheck);
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

  const fetchStudentDetails = async (student: Student) => {
    try {
      setLoadingDetails(true);

      // Fetch full student record (in case it has updated data)
      const { data: fullStudent, error: studentError } = await supabase
        .from("students")
        .select("*")
        .eq("id", student.id)
        .single();

      if (!studentError && fullStudent) {
        setSelectedStudent(fullStudent);
      }

      // Fetch emergency contacts
      const { data: contacts } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("student_id", student.id);
      setEmergencyContacts(contacts || []);

      // Fetch parent links with profiles
      const { data: links, error: linksError } = await supabase
        .from("parent_student_links")
        .select("id, relationship, parent_user_id")
        .eq("student_id", student.id)
        .eq("school_id", profile?.school_id);

      if (!linksError && links && links.length > 0) {
        const parentIds = links.map((l) => l.parent_user_id);
        const { data: profileData } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, mobile_number")
          .in("user_id", parentIds);

        const formattedLinks = links.map((link) => {
          const p = profileData?.find(
            (pd) => pd.user_id === link.parent_user_id
          );
          return {
            ...link,
            profile: p || null,
          };
        });
        setParentLinks(formattedLinks);
      } else {
        setParentLinks([]);
      }

      // Fetch enrollment history
      const { data: enrollmentData } = await supabase
        .from("enrollments")
        .select("*")
        .eq("student_id", student.id)
        .neq("status", "promoted")
        .order("enrollment_date", { ascending: false });
      setEnrollments(enrollmentData || []);

      // Fetch recent attendance (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { data: attData } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", student.id)
        .gte("date", sevenDaysAgo.toISOString().split("T")[0])
        .order("date", { ascending: false });
      setRecentAttendance(attData || []);
    } catch (error) {
      console.error("Error fetching student details:", error);
      Alert.alert("Error", "Failed to load student details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleStudentPress = (student: Student) => {
    setSelectedStudent(student);
    setShowStudentModal(true);
    fetchStudentDetails(student);
  };

  const totalStudents = classAssignments.reduce(
    (acc, curr) => acc + curr.students.length,
    0
  );

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.greeting,
            { color: isDarkMode ? "#94A3B8" : "#64748B" },
          ]}
        >
          Welcome back,
        </Text>
        <Text style={[styles.teacherName, { color: colors.text }]}>
          {profile?.full_name || "Teacher"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ alignItems: "flex-end" }}>
          <Text
            style={{
              fontSize: 13,
              color: colors.text,
              fontWeight: "700",
              letterSpacing: -0.3,
            }}
          >
            {new Date().toLocaleDateString("en-US", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </Text>
          <View
            style={{
              backgroundColor: colors.primary + "15",
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 6,
              marginTop: 4,
            }}
          >
            <Text
              style={{
                fontSize: 10,
                color: colors.primary,
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Term 1
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.profileButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
          onPress={() => router.push("/(tabs)/settings")}
        >
          <Ionicons name="person" size={22} color={colors.primary} />
          <View
            style={[styles.profileStatus, { backgroundColor: "#10B981" }]}
          />
        </TouchableOpacity>
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

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <StatCard
        label="Total Students"
        value={totalStudents}
        icon="people"
        colors={["#4F46E5", "#3730A3"]}
      />
      <StatCard
        label="Present Today"
        value={todayAttendance}
        icon="checkmark-circle"
        colors={["#10B981", "#059669"]}
      />
      <StatCard
        label="Attendance"
        value={`${
          totalStudents > 0
            ? Math.round((todayAttendance / totalStudents) * 100)
            : 0
        }%`}
        icon="pie-chart"
        colors={["#F59E0B", "#D97706"]}
      />
    </View>
  );

  const renderStudent = (item: Student) => {
    const fullName = [item.first_name, item.middle_name, item.last_name]
      .filter(Boolean)
      .join(" ");

    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.studentItem,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
          },
        ]}
        onPress={() => handleStudentPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.studentAvatar}>
          {item.profile_picture_url ? (
            <Image
              source={{ uri: item.profile_picture_url }}
              style={styles.listAvatar}
            />
          ) : (
            <View
              style={[
                styles.avatarPlaceholder,
                { backgroundColor: colors.primary + "10" },
              ]}
            >
              <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                {item.first_name?.[0]?.toUpperCase()}
                {item.last_name?.[0]?.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.studentInfo}>
          <Text style={[styles.studentName, { color: colors.text }]}>
            {fullName}
          </Text>
          <Text style={[styles.studentId, { color: colors.placeholderText }]}>
            ID: {item.student_id}
          </Text>
        </View>
        <View style={styles.activityAction}>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.placeholderText}
          />
        </View>
      </TouchableOpacity>
    );
  };

  const renderStudentList = () => {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Student List
          </Text>
          <Text style={{ color: colors.placeholderText, fontSize: 13 }}>
            {students.length} Students
          </Text>
        </View>

        {students.length > 0 ? (
          students.map((student) => renderStudent(student))
        ) : (
          <View
            style={[styles.emptyState, { backgroundColor: colors.card + "50" }]}
          >
            <Ionicons
              name="people-outline"
              size={48}
              color={colors.placeholderText}
            />
            <Text
              style={[
                styles.emptyStateText,
                { color: colors.placeholderText, marginTop: 12 },
              ]}
            >
              {selectedClassId
                ? "No active students in this class."
                : "Please select a class to view students."}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderDetailRow = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string | null | undefined
  ) => (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.detailLabel, { color: colors.placeholderText }]}>
          {label}
        </Text>
        <Text style={[styles.detailValue, { color: colors.text }]}>
          {value || "N/A"}
        </Text>
      </View>
    </View>
  );

  const getAttendanceColor = (status: string) => {
    switch (status) {
      case "present":
        return "#10B981";
      case "absent":
        return "#EF4444";
      case "late":
        return "#F59E0B";
      case "excused":
        return "#3B82F6";
      default:
        return colors.placeholderText;
    }
  };

  const renderStudentModal = () => {
    if (!selectedStudent) return null;

    const fullName = [
      selectedStudent.first_name,
      selectedStudent.middle_name,
      selectedStudent.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Modal
        visible={showStudentModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowStudentModal(false)}
      >
        <View
          style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Student Profile
              </Text>
              <TouchableOpacity onPress={() => setShowStudentModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.modalProfileSection}>
                <View
                  style={[
                    styles.modalAvatar,
                    { backgroundColor: colors.primary + "15" },
                  ]}
                >
                  {selectedStudent.profile_picture_url ? (
                    <Image
                      source={{ uri: selectedStudent.profile_picture_url }}
                      style={{ width: 80, height: 80, borderRadius: 40 }}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.modalAvatarText,
                        { color: colors.primary },
                      ]}
                    >
                      {selectedStudent.first_name?.[0]}
                      {selectedStudent.last_name?.[0]}
                    </Text>
                  )}
                </View>
                <Text style={[styles.modalStudentName, { color: colors.text }]}>
                  {fullName}
                </Text>
                <View
                  style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
                >
                  <Text
                    style={[
                      styles.modalStudentId,
                      { color: colors.placeholderText },
                    ]}
                  >
                    ID: {selectedStudent.student_id}
                  </Text>
                  {selectedStudent.class_level && (
                    <>
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: colors.placeholderText,
                        }}
                      />
                      <Text
                        style={[
                          styles.modalStudentId,
                          { color: colors.placeholderText },
                        ]}
                      >
                        {selectedStudent.class_level}
                      </Text>
                    </>
                  )}
                </View>
              </View>

              {loadingDetails ? (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <>
                  {/* Personal Information */}
                  <View
                    style={[
                      styles.detailSection,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      PERSONAL INFORMATION
                    </Text>
                    {renderDetailRow(
                      "calendar-outline",
                      "Date of Birth",
                      selectedStudent.date_of_birth
                        ? new Date(
                            selectedStudent.date_of_birth
                          ).toLocaleDateString()
                        : null
                    )}
                    {renderDetailRow(
                      "person-outline",
                      "Gender",
                      selectedStudent.gender
                    )}
                    {renderDetailRow(
                      "flag-outline",
                      "Nationality",
                      selectedStudent.nationality
                    )}
                    {renderDetailRow(
                      "home-outline",
                      "Address",
                      selectedStudent.address
                    )}
                  </View>

                  {/* Academic Information */}
                  <View
                    style={[
                      styles.detailSection,
                      {
                        backgroundColor: colors.card,
                        borderLeftWidth: 4,
                        borderLeftColor: "#4F46E5",
                      },
                    ]}
                  >
                    <Text
                      style={[styles.detailSectionTitle, { color: "#4F46E5" }]}
                    >
                      ACADEMIC INFORMATION
                    </Text>
                    {renderDetailRow(
                      "school-outline",
                      "Class Level",
                      selectedStudent.class_level
                    )}
                    {renderDetailRow(
                      "layers-outline",
                      "Section",
                      selectedStudent.section
                    )}
                    {renderDetailRow(
                      "ribbon-outline",
                      "Admission Date",
                      selectedStudent.admission_date
                        ? new Date(
                            selectedStudent.admission_date
                          ).toLocaleDateString()
                        : null
                    )}
                    {renderDetailRow(
                      "checkmark-circle-outline",
                      "Status",
                      selectedStudent.status
                    )}
                    {renderDetailRow(
                      "school-outline",
                      "Enrollment Status",
                      selectedStudent.enrollment_status
                    )}
                  </View>

                  {/* Health Information */}
                  <View
                    style={[
                      styles.detailSection,
                      {
                        backgroundColor: colors.card,
                        borderLeftWidth: 4,
                        borderLeftColor: "#F59E0B",
                      },
                    ]}
                  >
                    <Text
                      style={[styles.detailSectionTitle, { color: "#D97706" }]}
                    >
                      HEALTH & MEDICAL
                    </Text>
                    <View style={styles.detailRow}>
                      <Ionicons
                        name="medkit-outline"
                        size={20}
                        color="#D97706"
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.detailLabel,
                            { color: colors.placeholderText },
                          ]}
                        >
                          Medical Conditions
                        </Text>
                        <Text
                          style={[styles.detailValue, { color: colors.text }]}
                        >
                          {selectedStudent.medical_conditions ||
                            "None recorded"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Parent Contacts */}
                  <View
                    style={[
                      styles.detailSection,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      PARENTAL CONTACTS
                    </Text>
                    {parentLinks.length > 0 ? (
                      parentLinks.map((link, idx) => (
                        <View
                          key={idx}
                          style={[
                            styles.subSection,
                            {
                              borderTopWidth: idx > 0 ? 1 : 0,
                              borderTopColor: colors.border,
                              paddingTop: idx > 0 ? 12 : 0,
                              marginTop: idx > 0 ? 12 : 0,
                            },
                          ]}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <Text
                              style={{ fontWeight: "bold", color: colors.text }}
                            >
                              {link.profile?.full_name || "Unknown"}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                color: colors.primary,
                                textTransform: "capitalize",
                              }}
                            >
                              {link.relationship}
                            </Text>
                          </View>
                          {renderDetailRow(
                            "mail-outline",
                            "Email",
                            link.profile?.email
                          )}
                          {renderDetailRow(
                            "call-outline",
                            "Mobile",
                            link.profile?.mobile_number
                          )}
                        </View>
                      ))
                    ) : (
                      <Text
                        style={[
                          styles.noInfoText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        No linked parent accounts
                      </Text>
                    )}
                  </View>

                  {/* Emergency Contacts */}
                  <View
                    style={[
                      styles.detailSection,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      EMERGENCY CONTACTS
                    </Text>
                    {emergencyContacts.length > 0 ? (
                      emergencyContacts.map((contact, idx) => (
                        <View
                          key={idx}
                          style={[
                            styles.subSection,
                            {
                              borderTopWidth: idx > 0 ? 1 : 0,
                              borderTopColor: colors.border,
                              paddingTop: idx > 0 ? 12 : 0,
                              marginTop: idx > 0 ? 12 : 0,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontWeight: "bold",
                              color: colors.text,
                              marginBottom: 8,
                            }}
                          >
                            {contact.contact_name}
                          </Text>
                          {renderDetailRow(
                            "heart-outline",
                            "Relationship",
                            contact.relationship
                          )}
                          {renderDetailRow(
                            "call-outline",
                            "Primary Phone",
                            contact.phone_primary
                          )}
                          {contact.phone_secondary &&
                            renderDetailRow(
                              "call-outline",
                              "Secondary Phone",
                              contact.phone_secondary
                            )}
                        </View>
                      ))
                    ) : (
                      <Text
                        style={[
                          styles.noInfoText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        No emergency contacts found
                      </Text>
                    )}
                  </View>

                  {/* Enrollment History */}
                  <View
                    style={[
                      styles.detailSection,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      ACADEMIC HISTORY
                    </Text>
                    {enrollments.length > 0 ? (
                      enrollments.map((enrollment, idx) => (
                        <View key={idx} style={styles.enrollmentRow}>
                          <View>
                            <Text
                              style={{ fontWeight: "600", color: colors.text }}
                            >
                              {enrollment.class_level}
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                color: colors.placeholderText,
                              }}
                            >
                              {enrollment.academic_year}
                            </Text>
                          </View>
                          <Text
                            style={{
                              fontSize: 13,
                              color: colors.placeholderText,
                            }}
                          >
                            {enrollment.enrollment_date
                              ? new Date(
                                  enrollment.enrollment_date
                                ).getFullYear()
                              : ""}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text
                        style={[
                          styles.noInfoText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        No enrollment history found
                      </Text>
                    )}
                  </View>

                  {/* Recent Attendance */}
                  <View
                    style={[
                      styles.detailSection,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      RECENT ATTENDANCE
                    </Text>
                    {recentAttendance.length > 0 ? (
                      recentAttendance.map((record, idx) => (
                        <View key={idx} style={styles.attendanceHistoryRow}>
                          <View>
                            <Text
                              style={{ fontWeight: "600", color: colors.text }}
                            >
                              {new Date(record.date).toLocaleDateString(
                                undefined,
                                {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                }
                              )}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor:
                                  getAttendanceColor(record.status) + "20",
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color: getAttendanceColor(record.status),
                                fontSize: 12,
                                fontWeight: "bold",
                                textTransform: "uppercase",
                              }}
                            >
                              {record.status}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text
                        style={[
                          styles.noInfoText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        No recent attendance records
                      </Text>
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

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
      {renderStudentModal()}
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
    fontSize: 15,
    opacity: 0.5,
    fontWeight: "500",
    letterSpacing: -0.1,
  },
  teacherName: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -1,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  profileStatus: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
    gap: 10,
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
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  classCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  classCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  classCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  classCardSubtitle: {
    fontSize: 12,
    opacity: 0.6,
  },
  singleClassCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 3,
  },
  singleClassIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  singleClassTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  singleClassSubtitle: {
    fontSize: 13,
    opacity: 0.7,
  },
  studentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
  },
  studentAvatar: {
    marginRight: 14,
  },
  listAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarLetter: {
    fontSize: 14,
    fontWeight: "bold",
  },
  studentInfo: {
    flex: 1,
    justifyContent: "center",
  },
  studentName: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  studentId: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.6,
  },
  activityAction: {
    paddingLeft: 8,
    opacity: 0.5,
  },
  emptyState: {
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "75%",
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  modalBody: {
    padding: 20,
  },
  modalProfileSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  modalAvatarText: {
    fontSize: 32,
    fontWeight: "bold",
  },
  modalStudentName: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalStudentId: {
    fontSize: 14,
  },
  detailSection: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailSectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 12,
    letterSpacing: 1,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "600",
  },
  noInfoText: {
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 10,
  },
  subSection: {
    marginBottom: 12,
  },
  enrollmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  attendanceHistoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
});
