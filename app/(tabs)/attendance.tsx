import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

interface StudentAttendance {
  student_id: string;
  student_name: string;
  student_number: string;
  status: "present" | "absent" | "late" | "excused";
  notes?: string;
}

export default function AttendanceScreen() {
  const { hasRole, user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [classInfo, setClassInfo] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isParent = hasRole("parent");
  const isTeacher = hasRole("teacher");

  useEffect(() => {
    if (isTeacher) {
      loadTeacherAttendance();
    } else if (isParent) {
      loadParentAttendance();
    }
  }, [isTeacher, isParent, selectedDate]);

  const loadParentAttendance = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) setLoading(true);

      // Step 1: Get parent-student links
      const { data: links, error: linksError } = await supabase
        .from("parent_student_links")
        .select(
          `
          student_id,
          students!inner (
            id,
            first_name,
            last_name,
            student_id
          )
        `
        )
        .eq("parent_user_id", user?.id);

      if (linksError) throw linksError;

      if (!links || links.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      // Step 2: Fetch attendance for these students on selected date
      const studentIds = links.map((link: any) => link.student_id);
      const { data: attendanceData, error: attendanceError } = await supabase
        .from("attendance")
        .select("*")
        .in("student_id", studentIds)
        .eq("date", selectedDate)
        .eq("school_id", profile?.school_id);

      if (attendanceError) throw attendanceError;

      // Create attendance map
      const attendanceMap = new Map();
      attendanceData?.forEach((record: any) => {
        attendanceMap.set(record.student_id, record);
      });

      // Combine data
      const studentAttendanceData = links.map((link: any) => {
        const student = link.students;
        const record = attendanceMap.get(student.id);

        return {
          student_id: student.id,
          student_name: `${student.first_name} ${student.last_name}`,
          student_number: student.student_id,
          status: record?.status || "present",
          is_marked: !!record,
          notes: record?.notes || "",
        };
      });

      setStudents(studentAttendanceData);
    } catch (error) {
      console.error("Error loading parent attendance:", error);
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
    }
  };

  const loadTeacherAttendance = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) setLoading(true);

      // Step 1: Get teacher record
      const { data: teacherRecord, error: teacherError } = await supabase
        .from("teachers")
        .select("id")
        .eq("user_id", profile?.user_id)
        .eq("school_id", profile?.school_id)
        .single();

      if (teacherError || !teacherRecord) {
        console.log("No teacher record found");
        setLoading(false);
        return;
      }

      // Step 2: Get class assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select(
          `
          class_id,
          classes!teacher_assignments_class_id_fkey!inner (
            class_id,
            name
          )
        `
        )
        .eq("teacher_id", teacherRecord.id)
        .eq("assignment_type", "class_teacher")
        .eq("status", "active")
        .eq("school_id", profile?.school_id)
        .maybeSingle();

      if (assignmentError) throw assignmentError;

      if (!assignment) {
        setLoading(false);
        return;
      }

      const classData = assignment.classes as any;
      setClassInfo({
        id: assignment.class_id,
        name: classData.name,
      });

      // Step 3: Fetch students
      const { data: enrollments, error: studentsError } = await supabase
        .from("enrollments")
        .select(
          `
          student_id,
          students!enrollments_student_id_fkey!inner (
            id,
            student_id,
            first_name,
            last_name
          )
        `
        )
        .eq("class_id", assignment.class_id)
        .eq("status", "active")
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      // Step 4: Fetch existing attendance for this date
      const { data: existingAttendance, error: attendanceError } =
        await supabase
          .from("attendance")
          .select("*")
          .eq("class_id", assignment.class_id)
          .eq("date", selectedDate)
          .eq("school_id", profile?.school_id);

      if (attendanceError) throw attendanceError;

      // Create attendance map
      const attendanceMap = new Map();
      existingAttendance?.forEach((record: any) => {
        attendanceMap.set(record.student_id, record);
      });

      // Combine student and attendance data
      const studentAttendanceData =
        enrollments?.map((enrollment: any) => {
          const student = enrollment.students;
          const existingRecord = attendanceMap.get(student.id);

          return {
            student_id: student.id,
            student_name: `${student.first_name} ${student.last_name}`,
            student_number: student.student_id,
            status: existingRecord?.status || "present",
            notes: existingRecord?.notes || "",
          };
        }) || [];

      setStudents(studentAttendanceData);
    } catch (error) {
      console.error("Error loading attendance:", error);
      Alert.alert("Error", "Failed to load attendance data");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (isTeacher) {
      await loadTeacherAttendance(true);
    } else if (isParent) {
      await loadParentAttendance(true);
    }
    setRefreshing(false);
  };

  const handleStatusChange = (
    studentId: string,
    status: "present" | "absent" | "late" | "excused"
  ) => {
    setStudents((prev) =>
      prev.map((student) =>
        student.student_id === studentId ? { ...student, status } : student
      )
    );
  };

  const handleNotesChange = (studentId: string, notes: string) => {
    setStudents((prev) =>
      prev.map((student) =>
        student.student_id === studentId ? { ...student, notes } : student
      )
    );
  };

  const markAllPresent = () => {
    setStudents((prev) =>
      prev.map((student) => ({ ...student, status: "present" }))
    );
  };

  const handleSaveAttendance = async () => {
    try {
      setSaving(true);

      const attendanceRecords = students.map((student) => ({
        school_id: profile?.school_id,
        student_id: student.student_id,
        class_id: classInfo.id,
        date: selectedDate,
        status: student.status,
        notes: student.notes || null,
        marked_by: user?.id,
      }));

      // Delete existing records
      const { error: deleteError } = await supabase
        .from("attendance")
        .delete()
        .eq("school_id", profile?.school_id)
        .eq("date", selectedDate)
        .eq("class_id", classInfo.id);

      if (deleteError) throw deleteError;

      // Insert new records
      if (attendanceRecords.length > 0) {
        const { error: insertError } = await supabase
          .from("attendance")
          .insert(attendanceRecords);

        if (insertError) throw insertError;
      }

      Alert.alert("Success", "Attendance saved successfully");
    } catch (error) {
      console.error("Error saving attendance:", error);
      Alert.alert("Error", "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  const getStatusStats = () => {
    const present = students.filter((s) => s.status === "present").length;
    const absent = students.filter((s) => s.status === "absent").length;
    const late = students.filter((s) => s.status === "late").length;
    const excused = students.filter((s) => s.status === "excused").length;
    return { present, absent, late, excused, total: students.length };
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

  const stats = getStatusStats();

  if (!isTeacher && !isParent) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={60} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            Attendance view is not available for your role.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading attendance...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isTeacher && !classInfo) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.emptyContainer}>
          <Ionicons name="school-outline" size={60} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            You don't have a class assignment yet
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isParent && students.length === 0) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={60} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>
            No students linked to your account.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {isTeacher ? "Take Attendance" : "My Children's Attendance"}
          </Text>
          <Text
            style={[styles.headerSubtitle, { color: colors.placeholderText }]}
          >
            {isTeacher ? classInfo.name : "View attendance records"}
          </Text>
        </View>
        {isTeacher && (
          <TouchableOpacity
            onPress={markAllPresent}
            style={[styles.markAllButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.markAllText}>All Present</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Date Selector */}
      <View
        style={[
          styles.dateContainer,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.dateInputWrapper,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={20}
            color={colors.placeholderText}
          />
          <TextInput
            style={[styles.dateInput, { color: colors.text }]}
            value={selectedDate}
            onChangeText={setSelectedDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.placeholderText}
          />
        </View>
        <Text style={[styles.dateHelper, { color: colors.placeholderText }]}>
          {selectedDate === new Date().toISOString().split("T")[0]
            ? "Today"
            : "Past Date"}
        </Text>
      </View>

      {/* Stats - Only show for teachers */}
      {isTeacher && (
        <View style={styles.statsContainer}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {stats.total}
            </Text>
            <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
              Total
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: "#28a745" }]}>
              {stats.present}
            </Text>
            <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
              Present
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: "#dc3545" }]}>
              {stats.absent}
            </Text>
            <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
              Absent
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: "#ffc107" }]}>
              {stats.late}
            </Text>
            <Text style={[styles.statLabel, { color: colors.placeholderText }]}>
              Late
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {students.map((student: any) => (
          <View
            key={student.student_id}
            style={[styles.studentCard, { backgroundColor: colors.card }]}
          >
            <View style={styles.studentHeader}>
              <View>
                <Text style={[styles.studentName, { color: colors.text }]}>
                  {student.student_name}
                </Text>
                <Text
                  style={[
                    styles.studentNumber,
                    { color: colors.placeholderText },
                  ]}
                >
                  {student.student_number}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      (student.is_marked === false && isParent
                        ? colors.border
                        : getStatusColor(student.status)) + "20",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    {
                      color:
                        student.is_marked === false && isParent
                          ? colors.placeholderText
                          : getStatusColor(student.status),
                    },
                  ]}
                >
                  {isParent && student.is_marked === false
                    ? "NOT MARKED"
                    : student.status.toUpperCase()}
                </Text>
              </View>
            </View>

            {isTeacher ? (
              // Teacher Controls
              <>
                <View style={styles.statusButtons}>
                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                      student.status === "present" && styles.statusButtonActive,
                      student.status === "present" && {
                        backgroundColor: "#28a745",
                      },
                    ]}
                    onPress={() =>
                      handleStatusChange(student.student_id, "present")
                    }
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        { color: colors.placeholderText },
                        student.status === "present" &&
                          styles.statusButtonTextActive,
                      ]}
                    >
                      P
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                      student.status === "absent" && styles.statusButtonActive,
                      student.status === "absent" && {
                        backgroundColor: "#dc3545",
                      },
                    ]}
                    onPress={() =>
                      handleStatusChange(student.student_id, "absent")
                    }
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        { color: colors.placeholderText },
                        student.status === "absent" &&
                          styles.statusButtonTextActive,
                      ]}
                    >
                      A
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                      student.status === "late" && styles.statusButtonActive,
                      student.status === "late" && {
                        backgroundColor: "#ffc107",
                      },
                    ]}
                    onPress={() =>
                      handleStatusChange(student.student_id, "late")
                    }
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        { color: colors.placeholderText },
                        student.status === "late" &&
                          styles.statusButtonTextActive,
                      ]}
                    >
                      L
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                      student.status === "excused" && styles.statusButtonActive,
                      student.status === "excused" && {
                        backgroundColor: "#6c757d",
                      },
                    ]}
                    onPress={() =>
                      handleStatusChange(student.student_id, "excused")
                    }
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        { color: colors.placeholderText },
                        student.status === "excused" &&
                          styles.statusButtonTextActive,
                      ]}
                    >
                      E
                    </Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[
                    styles.notesInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="Add notes..."
                  placeholderTextColor={colors.placeholderText}
                  value={student.notes || ""}
                  onChangeText={(text) =>
                    handleNotesChange(student.student_id, text)
                  }
                  multiline
                />
              </>
            ) : (
              // Parent View (Read Only)
              <View>
                {student.notes ? (
                  <Text style={[styles.notesText, { color: colors.text }]}>
                    Notes: {student.notes}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {isTeacher && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary },
              saving && styles.saveButtonDisabled,
            ]}
            onPress={handleSaveAttendance}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="save" size={20} color="white" />
                <Text style={styles.saveButtonText}>Save Attendance</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  markAllButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  markAllText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  dateContainer: {
    padding: 16,
    borderBottomWidth: 1,
  },
  dateInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  dateInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },
  dateHelper: {
    fontSize: 12,
    marginTop: 8,
  },
  statsContainer: {
    flexDirection: "row",
    padding: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "bold",
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  studentCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  studentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  studentName: {
    fontSize: 18,
    fontWeight: "600",
  },
  studentNumber: {
    fontSize: 14,
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statusButtons: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statusButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
  },
  statusButtonActive: {
    borderColor: "transparent",
  },
  statusButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  statusButtonTextActive: {
    color: "white",
  },
  notesInput: {
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 44,
    borderWidth: 1,
  },
  notesText: {
    fontSize: 14,
    fontStyle: "italic",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
});
