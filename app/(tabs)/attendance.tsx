import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedText as Text } from "../../components/ThemedText";

import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { checkGeofence } from "../../lib/location";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

interface StudentAttendance {
  student_id: string;
  student_name: string;
  student_number: string;
  first_name: string;
  last_name: string;
  profile_picture_url?: string;
  status: "present" | "absent" | "late" | "excused" | null;
  notes?: string;
  is_marked?: boolean;
}

interface ClassAssignment {
  assignment_id: string;
  class_id: string;
  name: string;
}

export default function AttendanceScreen() {
  const { hasRole, user, profile, school } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Teacher Class Data
  const [classAssignments, setClassAssignments] = useState<ClassAssignment[]>(
    []
  );
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Bulk Selection State
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set()
  );

  // New state for personal attendance
  const [viewMode, setViewMode] = useState<"students" | "mine">("students");
  const [myAttendanceRecord, setMyAttendanceRecord] = useState<any>(null);
  const [staffRecord, setStaffRecord] = useState<any>(null);
  const [loadingMyAttendance, setLoadingMyAttendance] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [locationStatus, setLocationStatus] = useState<{
    distance?: number;
    error?: string;
  } | null>(null);
  const selectionMode = selectedStudentIds.size > 0;

  const toggleNote = (studentId: string) => {
    setExpandedNoteIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const toggleSelection = (studentId: string) => {
    setSelectedStudentIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const handleBulkMark = (
    status: "present" | "absent" | "late" | "excused"
  ) => {
    setStudents((prev) =>
      prev.map((s) =>
        selectedStudentIds.has(s.student_id) ? { ...s, status } : s
      )
    );
    setSelectedStudentIds(new Set()); // Exit selection mode
  };

  const selectAll = () => {
    if (selectedStudentIds.size === students.length) {
      setSelectedStudentIds(new Set());
    }
  };

  const onDateChange = (event: any, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      setSelectedDate(date.toISOString().split("T")[0]);
    }
  };

  // Parent Data
  const [classInfo, setClassInfo] = useState<any>(null); // Kept for parent view or legacy
  const [refreshing, setRefreshing] = useState(false);

  // Computed
  const isParent = hasRole("parent");
  const isTeacher = hasRole("teacher");
  const activeClassId = selectedClassId || (classInfo?.id as string);

  useEffect(() => {
    if (isTeacher) {
      if (viewMode === "students") {
        loadTeacherAttendance();
      } else {
        loadMyAttendance();
      }
    } else if (isParent) {
      loadParentAttendance();
    }
  }, [isTeacher, isParent, selectedDate, selectedClassId, viewMode]);

  const loadMyAttendance = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) setLoadingMyAttendance(true);

      // Step 1: Get/Ensure staff record
      let currentStaffRecord = staffRecord;
      if (!currentStaffRecord) {
        const { data: sRecord, error: sError } = await supabase
          .from("staff")
          .select("*")
          .eq("user_id", user?.id)
          .eq("school_id", profile?.school_id)
          .maybeSingle();

        if (sError) throw sError;
        currentStaffRecord = sRecord;
        setStaffRecord(sRecord);
      }

      if (!currentStaffRecord) {
        setMyAttendanceRecord(null);
        return;
      }

      // Step 2: Fetch attendance for this staff member on selected date
      const { data: attendanceData, error: attendanceError } = await supabase
        .from("attendance")
        .select("*")
        .eq("staff_id", currentStaffRecord.id)
        .eq("date", selectedDate)
        .eq("school_id", profile?.school_id)
        .maybeSingle();

      if (attendanceError) throw attendanceError;
      setMyAttendanceRecord(attendanceData);
    } catch (error) {
      console.error("Error loading personal attendance:", error);
    } finally {
      setLoadingMyAttendance(false);
    }
  };

  const handleClockAction = async (type: "in" | "out") => {
    if (!school || !user || !profile) {
      Alert.alert("Error", "Missing school or user information");
      return;
    }

    if (school.latitude === null || school.longitude === null) {
      Alert.alert(
        "Location Error",
        "School location is not configured. Please contact administration."
      );
      return;
    }

    setIsMarking(true);
    setLocationStatus(null);

    try {
      // 0. Ensure staffRecord is available
      let currentStaffRecord = staffRecord;
      if (!currentStaffRecord) {
        const { data: sRecord, error: sError } = await supabase
          .from("staff")
          .select("*")
          .eq("user_id", user?.id)
          .eq("school_id", profile?.school_id)
          .maybeSingle();

        if (sError) throw sError;
        if (!sRecord) {
          Alert.alert("Error", "No staff record found for your account.");
          setIsMarking(false);
          return;
        }
        currentStaffRecord = sRecord;
        setStaffRecord(sRecord);
      }

      // 1. Check Geofence
      const radius = school.settings?.attendance?.geofence_radius || 200;
      const geofenceResult = await checkGeofence(
        school.latitude,
        school.longitude,
        radius
      );

      setLocationStatus({
        distance: geofenceResult.distance,
        error: geofenceResult.error,
      });

      if (geofenceResult.error) {
        Alert.alert("Location Error", geofenceResult.error);
        return;
      }

      if (!geofenceResult.isWithinFence) {
        Alert.alert(
          "Out of Range",
          `You are ${geofenceResult.distance}m away. You must be within ${radius}m of the school to clock ${type}.`
        );
        return;
      }

      // 2. Perform Attendance Action
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0]; // HH:MM:SS
      const dateStr = now.toISOString().split("T")[0];

      if (type === "in") {
        // Upsert for Clock In
        const { data, error } = await supabase
          .from("attendance")
          .upsert({
            school_id: profile.school_id,
            staff_id: currentStaffRecord.id,
            date: dateStr,
            status: "present",
            check_in_time: timeStr,
            marked_by: user.id,
          }, {
            onConflict: "school_id,staff_id,date"
          })
          .select()
          .single();

        if (error) throw error;
        setMyAttendanceRecord(data);
        Alert.alert("Success", "Clocked in successfully!");
      } else {
        // Update for Clock Out
        if (!myAttendanceRecord?.id) {
          Alert.alert("Error", "No clock-in record found for today.");
          return;
        }

        const { data, error } = await supabase
          .from("attendance")
          .update({
            check_out_time: timeStr,
          })
          .eq("id", myAttendanceRecord.id)
          .select()
          .single();

        if (error) throw error;
        setMyAttendanceRecord(data);
        Alert.alert("Success", "Clocked out successfully!");
      }
    } catch (error: any) {
      console.error(`Error during clock ${type}:`, error);
      Alert.alert("Error", error.message || `Failed to clock ${type}`);
    } finally {
      setIsMarking(false);
    }
  };

  // ... (loadParentAttendance and loadTeacherAttendance are above or below)

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
            profile_picture_url,
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
          first_name: student.first_name,
          last_name: student.last_name,
          profile_picture_url: student.profile_picture_url,
          student_number: student.student_id,
          status: record?.status || null,
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
        .limit(1)
        .maybeSingle();

      if (teacherError || !teacherRecord) {
        console.log("No teacher record found");
        setLoading(false);
        return;
      }

      // Step 2: Get ALL class assignments
      const { data: assignments, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select(
          `
          assignment_id,
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
        .eq("school_id", profile?.school_id);

      if (assignmentError) throw assignmentError;

      if (!assignments || assignments.length === 0) {
        setLoading(false);
        return;
      }

      // Process assignments
      const loadedAssignments: ClassAssignment[] = assignments.map(
        (a: any) => ({
          assignment_id: a.assignment_id,
          class_id: a.class_id,
          name: a.classes.name,
        })
      );

      setClassAssignments(loadedAssignments);

      // Determine target class
      let targetClassId = selectedClassId;
      if (!targetClassId && loadedAssignments.length > 0) {
        targetClassId = loadedAssignments[0].class_id;
        setSelectedClassId(targetClassId);
      } else if (
        targetClassId &&
        !loadedAssignments.find((a) => a.class_id === targetClassId)
      ) {
        // If selected class is no longer valid, fallback
        targetClassId = loadedAssignments[0].class_id;
        setSelectedClassId(targetClassId);
      }

      if (!targetClassId) {
        setLoading(false);
        return;
      }

      // Update class info for display
      const activeStats = loadedAssignments.find(
        (a) => a.class_id === targetClassId
      );
      if (activeStats) {
        setClassInfo({ id: activeStats.class_id, name: activeStats.name });
      }

      // Step 3: Fetch students for target class
      const { data: enrollments, error: studentsError } = await supabase
        .from("enrollments")
        .select(
          `
          student_id,
          students!enrollments_student_id_fkey!inner (
            id,
            student_id,
            first_name,
            last_name,
            profile_picture_url
          )
        `
        )
        .eq("class_id", targetClassId)
        .eq("status", "active")
        .eq("school_id", profile?.school_id);

      if (studentsError) throw studentsError;

      // Step 4: Fetch existing attendance for this date
      const { data: existingAttendance, error: attendanceError } =
        await supabase
          .from("attendance")
          .select("*")
          .eq("class_id", targetClassId)
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
            first_name: student.first_name,
            last_name: student.last_name,
            profile_picture_url: student.profile_picture_url,
            student_number: student.student_id,
            status: existingRecord?.status || null,
            is_marked: !!existingRecord,
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
      if (viewMode === "students") {
        await loadTeacherAttendance(true);
      } else {
        await loadMyAttendance(true);
      }
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

      const attendanceRecords = students
        .filter((s) => s.status !== null)
        .map((student) => ({
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

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "present":
        return "#10B981"; // Emerald
      case "absent":
        return "#EF4444"; // Red
      case "late":
        return "#F59E0B"; // Amber
      case "excused":
        return "#3B82F6"; // Blue
      default:
        return colors.placeholderText;
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

  // Calculate Progress
  const attendancePercentage =
    stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* 1. Top Bar (Title + Date) */}
      <View style={styles.topBar}>
        <View>
          <Text style={[styles.screenTitle, { color: colors.text }]}>
            Attendance
          </Text>
          <Text
            style={[styles.screenSubtitle, { color: colors.placeholderText }]}
          >
            Recording for: {new Date(selectedDate).toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: colors.card }]}
            onPress={() => setShowDatePicker(true)}
          >
            <Ionicons name="calendar" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* View Toggle for Teachers */}
      {isTeacher && (
        <View style={styles.segmentedControlContainer}>
          <TouchableOpacity
            style={[
              styles.segmentButton,
              viewMode === "students" && {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
              },
            ]}
            onPress={() => setViewMode("students")}
          >
            <Text
              style={[
                styles.segmentButtonText,
                { color: viewMode === "students" ? "white" : colors.text },
              ]}
            >
              Students
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentButton,
              viewMode === "mine" && {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
              },
            ]}
            onPress={() => setViewMode("mine")}
          >
            <Text
              style={[
                styles.segmentButtonText,
                { color: viewMode === "mine" ? "white" : colors.text },
              ]}
            >
              My Attendance
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {showDatePicker && (
        <DateTimePicker
          value={new Date(selectedDate)}
          mode="date"
          display="default"
          onChange={onDateChange}
        />
      )}

      {/* 2. Visual Stats Deck */}
      {isTeacher && viewMode === "students" && (
        <View style={[styles.studentDateBanner, { backgroundColor: colors.primary + "05" }]}>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text style={[styles.studentDateText, { color: colors.text }]}>
            Attendance for: <Text style={{ fontWeight: '700' }}>{new Date(selectedDate).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}</Text>
          </Text>
        </View>
      )}

      {isTeacher && viewMode === "students" && (
        <View style={[styles.statsDeck, { backgroundColor: colors.card }]}>
          <View style={styles.progressCircleContainer}>
            {/* Simple Circular Progress Simulation using Border */}
            <View
              style={[styles.progressCircle, { borderColor: colors.primary }]}
            >
              <Text style={[styles.progressText, { color: colors.text }]}>
                {attendancePercentage}%
              </Text>
            </View>
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: colors.text }]}>
                {stats.present}
              </Text>
              <Text
                style={[styles.statCaption, { color: colors.placeholderText }]}
              >
                Present
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: "#dc3545" }]}>
                {stats.absent}
              </Text>
              <Text
                style={[styles.statCaption, { color: colors.placeholderText }]}
              >
                Absent
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: "#ffc107" }]}>
                {stats.late}
              </Text>
              <Text
                style={[styles.statCaption, { color: colors.placeholderText }]}
              >
                Late
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* 3. Class Selector (Horizontal Scroller) */}
      {isTeacher && viewMode === "students" && classAssignments.length > 1 && (
        <View style={styles.classSelectorContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.classSelectorContent}
          >
            {classAssignments.map((assignment) => {
              const isSelected = activeClassId === assignment.class_id;
              return (
                <TouchableOpacity
                  key={assignment.class_id}
                  style={[
                    styles.largeClassChip,
                    isSelected
                      ? { backgroundColor: colors.primary }
                      : {
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: colors.border,
                      },
                  ]}
                  onPress={() => setSelectedClassId(assignment.class_id)}
                >
                  <Text
                    style={[
                      styles.largeClassChipText,
                      { color: isSelected ? "white" : colors.text },
                    ]}
                  >
                    {assignment.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 4. Student List (Enhanced) */}
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {loading || loadingMyAttendance ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>
              Loading attendance...
            </Text>
          </View>
        ) : isTeacher && viewMode === "students" && !classInfo ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="school-outline" size={60} color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.text }]}>
              You don't have a class assignment yet.
            </Text>
          </View>
        ) : isTeacher && viewMode === "mine" ? (
          <View style={styles.myAttendanceContainer}>
            <View style={[styles.myAttendanceCard, { backgroundColor: colors.card }]}>
              <View style={styles.myAttendanceHeader}>
                <View style={[styles.myAvatarLarge, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[styles.myAvatarText, { color: colors.primary }]}>
                    {profile?.full_name?.[0]?.toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.myName, { color: colors.text }]}>{profile?.full_name}</Text>
                  <Text style={[styles.myRole, { color: colors.placeholderText }]}>
                    Staff ID: {staffRecord?.employee_id || "N/A"}
                  </Text>
                </View>
              </View>

              <View style={[styles.dateDisplaySection, { backgroundColor: colors.primary + "05" }]}>
                <Ionicons name="calendar" size={18} color={colors.primary} />
                <Text style={[styles.dateDisplayText, { color: colors.text }]}>
                  Recording for: <Text style={{ fontWeight: '700' }}>{new Date(selectedDate).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}</Text>
                </Text>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View style={styles.myStatusSection}>
                <Text style={[styles.myStatusLabel, { color: colors.placeholderText }]}>
                  Attendance Status
                </Text>
                {myAttendanceRecord ? (
                  <View style={[styles.myStatusBadge, { backgroundColor: getStatusColor(myAttendanceRecord.status) + "20" }]}>
                    <Ionicons
                      name={myAttendanceRecord.status === 'present' ? 'checkmark-circle' : 'alert-circle'}
                      size={24}
                      color={getStatusColor(myAttendanceRecord.status)}
                    />
                    <Text style={[styles.myStatusText, { color: getStatusColor(myAttendanceRecord.status) }]}>
                      {myAttendanceRecord.status.toUpperCase()}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.myStatusBadge, { backgroundColor: colors.border + "50" }]}>
                    <Ionicons name="help-circle-outline" size={24} color={colors.placeholderText} />
                    <Text style={[styles.myStatusText, { color: colors.placeholderText }]}>
                      UNMARKED
                    </Text>
                  </View>
                )}
              </View>

              {(myAttendanceRecord?.check_in_time || myAttendanceRecord?.check_out_time) && (
                <View style={styles.timeSection}>
                  <View style={styles.timeColumn}>
                    <Text style={[styles.timeLabel, { color: colors.placeholderText }]}>Check In</Text>
                    <Text style={[styles.timeValue, { color: colors.text }]}>
                      {myAttendanceRecord.check_in_time || "--:--"}
                    </Text>
                  </View>
                  <View style={styles.timeColumn}>
                    <Text style={[styles.timeLabel, { color: colors.placeholderText }]}>Check Out</Text>
                    <Text style={[styles.timeValue, { color: colors.text }]}>
                      {myAttendanceRecord.check_out_time || "--:--"}
                    </Text>
                  </View>
                </View>
              )}

              {myAttendanceRecord?.notes && (
                <View style={styles.myNotesSection}>
                  <Text style={[styles.timeLabel, { color: colors.placeholderText }]}>Notes</Text>
                  <Text style={[styles.myNotesText, { color: colors.text }]}>
                    {myAttendanceRecord.notes}
                  </Text>
                </View>
              )}

              {/* Attendance Actions */}
              <View style={styles.actionContainer}>
                {selectedDate === new Date().toISOString().split("T")[0] && (
                  <View style={styles.clockButtonsContainer}>
                    {!myAttendanceRecord?.check_in_time ? (
                      <TouchableOpacity
                        style={[styles.clockButton, { backgroundColor: "#10B981" }]}
                        onPress={() => handleClockAction("in")}
                        disabled={isMarking}
                      >
                        {isMarking ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <>
                            <Ionicons name="log-in-outline" size={24} color="white" />
                            <Text style={styles.clockButtonText}>Clock In</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : !myAttendanceRecord?.check_out_time ? (
                      <TouchableOpacity
                        style={[styles.clockButton, { backgroundColor: "#EF4444" }]}
                        onPress={() => handleClockAction("out")}
                        disabled={isMarking}
                      >
                        {isMarking ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <>
                            <Ionicons name="log-out-outline" size={24} color="white" />
                            <Text style={styles.clockButtonText}>Clock Out</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.statusBanner, { backgroundColor: colors.primary + "15" }]}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        <Text style={[styles.statusBannerText, { color: colors.primary }]}>
                          Workday Completed
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {locationStatus && (
                  <View style={styles.locationInfo}>
                    <Ionicons
                      name={locationStatus.error ? "alert-circle" : "location"}
                      size={14}
                      color={locationStatus.error ? "#EF4444" : colors.placeholderText}
                    />
                    <Text style={[styles.locationText, { color: colors.placeholderText }]}>
                      {locationStatus.error
                        ? locationStatus.error
                        : `Distance: ${locationStatus.distance}m from school`}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : isParent && students.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={60} color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No students linked to your account.
            </Text>
          </View>
        ) : (
          <>
            {isTeacher && (
              <View style={styles.listHeader}>
                <Text style={[styles.listHeaderTitle, { color: colors.text }]}>
                  Students ({stats.total})
                </Text>
                <TouchableOpacity onPress={markAllPresent}>
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>
                    Mark All Present
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {students.map((student: any) => {
              const isSelected = selectedStudentIds.has(student.student_id);
              return (
                <TouchableOpacity
                  key={student.student_id}
                  style={[
                    styles.bigStudentCard,
                    {
                      backgroundColor: isSelected
                        ? colors.primary + "10"
                        : colors.card,
                      borderColor: isSelected ? colors.primary : "transparent",
                      borderWidth: isSelected ? 2 : 0,
                    },
                  ]}
                  onLongPress={() =>
                    isTeacher && toggleSelection(student.student_id)
                  }
                  onPress={() => {
                    if (selectionMode) {
                      toggleSelection(student.student_id);
                    }
                  }}
                  activeOpacity={selectionMode ? 0.7 : 1}
                  delayLongPress={300}
                >
                  {/* Top Row: Avatar + Name + Status Actions */}
                  <View style={styles.cardHeader}>
                    {/* Selection Checkbox (Visible in Selection Mode) */}
                    {selectionMode && (
                      <View style={{ marginRight: 12 }}>
                        <Ionicons
                          name={isSelected ? "checkbox" : "square-outline"}
                          size={24}
                          color={
                            isSelected ? colors.primary : colors.placeholderText
                          }
                        />
                      </View>
                    )}

                    <View
                      style={[
                        styles.bigAvatar,
                        { backgroundColor: colors.border },
                      ]}
                    >
                      {student.profile_picture_url ? (
                        <Image
                          source={{ uri: student.profile_picture_url }}
                          style={{ width: 40, height: 40, borderRadius: 20 }}
                        />
                      ) : (
                        <Text
                          style={[styles.avatarText, { color: colors.text }]}
                        >
                          {student.first_name[0]}
                          {student.last_name[0]}
                        </Text>
                      )}
                    </View>
                    <View style={styles.infoColumn}>
                      <Text style={[styles.cardName, { color: colors.text }]}>
                        {student.student_name}
                      </Text>
                      <Text
                        style={[
                          styles.cardId,
                          { color: colors.placeholderText },
                        ]}
                      >
                        {student.student_number}
                      </Text>
                    </View>
                  </View>

                  {/* Action Bar (Disabled pointer events when selecting to prevent accidental toggles, or just careful UI) */}
                  {isTeacher && !selectionMode ? (
                    <View style={styles.actionRow}>
                      {/* Status Toggles */}
                      <View style={styles.togglesContainer}>
                        {(
                          ["present", "absent", "late", "excused"] as const
                        ).map((status) => {
                          const isActive = student.status === status;
                          let activeColor = colors.primary;
                          let label = status.charAt(0).toUpperCase();

                          if (status === "present") {
                            activeColor = "#28a745";
                            label = "Present";
                          }
                          if (status === "absent") {
                            activeColor = "#dc3545";
                            label = "Absent";
                          }
                          if (status === "late") {
                            activeColor = "#ffc107";
                            label = "Late";
                          }
                          if (status === "excused") {
                            activeColor = "#6c757d";
                            label = "Excused";
                          }

                          return (
                            <TouchableOpacity
                              key={status}
                              style={[
                                styles.pillToggle,
                                isActive
                                  ? { backgroundColor: activeColor }
                                  : {
                                    backgroundColor: colors.background,
                                    borderWidth: 1,
                                    borderColor: colors.border,
                                  },
                              ]}
                              onPress={() =>
                                handleStatusChange(student.student_id, status)
                              }
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  {
                                    color: isActive ? "white" : colors.text,
                                    fontWeight: isActive ? "700" : "500",
                                  },
                                ]}
                              >
                                {isActive ? label : label.charAt(0)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Note Action */}
                      <TouchableOpacity
                        style={styles.iconAction}
                        onPress={() => toggleNote(student.student_id)}
                      >
                        <Ionicons
                          name={
                            student.notes ? "chatbox" : "chatbubble-outline"
                          }
                          size={22}
                          color={
                            student.notes
                              ? colors.primary
                              : colors.placeholderText
                          }
                        />
                      </TouchableOpacity>
                    </View>
                  ) : isTeacher && selectionMode ? (
                    <View style={{ paddingTop: 8, paddingBottom: 4 }}>
                      <Text
                        style={{
                          color: colors.primary,
                          fontStyle: "italic",
                          fontSize: 13,
                        }}
                      >
                        Selected - Use bottom bar to update
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.statusBadgeBig,
                        {
                          backgroundColor:
                            getStatusColor(student.status) + "20",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusTextBig,
                          { color: getStatusColor(student.status) },
                        ]}
                      >
                        {student.status.toUpperCase()}
                      </Text>
                    </View>
                  )}

                  {/* Notes Area */}
                  {isTeacher &&
                    (expandedNoteIds.has(student.student_id) ||
                      student.status === "excused") &&
                    !selectionMode && (
                      <View style={styles.noteContainer}>
                        <TextInput
                          style={[
                            styles.noteInput,
                            {
                              backgroundColor: colors.background,
                              color: colors.text,
                              borderColor: colors.border,
                            },
                          ]}
                          placeholder="Add a note..."
                          placeholderTextColor={colors.placeholderText}
                          value={student.notes || ""}
                          onChangeText={(text) =>
                            handleNotesChange(student.student_id, text)
                          }
                        />
                      </View>
                    )}
                  {isParent && student.notes && (
                    <Text
                      style={[
                        styles.noteDisplay,
                        { color: colors.placeholderText },
                      ]}
                    >
                      {student.notes}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 100 }} />
          </>
        )}
      </ScrollView>

      {/* Floating Footer (Save OR Bulk Actions) */}
      {isTeacher && viewMode === "students" && (
        <View
          style={[
            styles.floatingFooter,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          {selectionMode ? (
            <View style={styles.bulkActionContainer}>
              <View style={styles.bulkActionHeader}>
                <Text
                  style={[styles.bulkSelectionCount, { color: colors.text }]}
                >
                  {selectedStudentIds.size} Selected
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedStudentIds(new Set())}
                >
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.bulkButtonsRow}>
                {(["present", "absent", "late", "excused"] as const).map(
                  (status) => {
                    let label = status.charAt(0).toUpperCase();
                    let color = colors.primary;
                    if (status === "present") color = "#28a745";
                    if (status === "absent") color = "#dc3545";
                    if (status === "late") color = "#ffc107";
                    if (status === "excused") color = "#6c757d";

                    return (
                      <TouchableOpacity
                        key={status}
                        style={[
                          styles.bulkActionButton,
                          { backgroundColor: color },
                        ]}
                        onPress={() => handleBulkMark(status)}
                      >
                        <Text style={styles.bulkActionText}>{label}</Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.bigSaveButton,
                { backgroundColor: colors.primary },
                saving && { opacity: 0.7 },
              ]}
              onPress={handleSaveAttendance}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.bigSaveButtonText}>Save Attendance</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    // fontWeight: "bold",
    marginBottom: 12,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "800",
  },
  screenSubtitle: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: "500",
  },
  topBarActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  statsDeck: {
    padding: 12,
    marginHorizontal: 16,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  progressCircleContainer: {
    marginRight: 16,
  },
  progressCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  progressText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  progressLabel: {
    fontSize: 8,
    display: "none", // Hide label inside small circle
  },
  statsGrid: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around", // Better spacing for compact
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 16,
    fontWeight: "700",
  },
  statCaption: {
    fontSize: 11,
    marginTop: 2,
  },
  classSelectorContainer: {
    marginBottom: 20,
  },
  classSelectorContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  largeClassChip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30, // Pill shape
  },
  largeClassChipText: {
    fontSize: 15,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  listHeaderTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  bigStudentCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  bigAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  statValue: {
    fontSize: 20,
    // fontWeight: "bold",
    marginBottom: 4,
  },
  infoColumn: {
    justifyContent: "center",
  },
  cardName: {
    fontSize: 17, // Larger text
    fontWeight: "700",
  },
  cardId: {
    fontSize: 13,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  togglesContainer: {
    flexDirection: "row",
    gap: 8,
  },
  pillToggle: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  pillText: {
    fontSize: 13,
  },
  iconAction: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  noteContainer: {
    marginTop: 16,
  },
  noteInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  noteDisplay: {
    marginTop: 12,
    fontStyle: "italic",
  },
  statusBadgeBig: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusTextBig: {
    fontSize: 14,
    fontWeight: "700",
  },
  floatingFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 20, // Reduced safe area padding
    borderTopWidth: 1,
  },
  bigSaveButton: {
    height: 48, // Reduced from 56
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  bigSaveButtonText: {
    color: "white",
    fontSize: 16, // Reduced from 18
    fontWeight: "bold",
  },
  bulkActionContainer: {
    gap: 12,
  },
  bulkActionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  bulkSelectionCount: {
    fontSize: 14,
    fontWeight: "700",
  },
  bulkButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  bulkActionButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  bulkActionText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 16,
    marginTop: 10,
  },
  headerTopRow: { flexDirection: "row" }, // kept for safety if referenced else where but rewritten
  segmentedControlContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  segmentButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  myAttendanceContainer: {
    paddingTop: 10,
  },
  myAttendanceCard: {
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  myAttendanceHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 16,
  },
  myAvatarLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  myAvatarText: {
    fontSize: 24,
    fontWeight: "bold",
  },
  myName: {
    fontSize: 20,
    fontWeight: "700",
  },
  myRole: {
    fontSize: 14,
    marginTop: 2,
  },
  dateDisplaySection: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  dateDisplayText: {
    fontSize: 14,
  },
  studentDateBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.03)",
  },
  studentDateText: {
    fontSize: 14,
  },
  divider: {
    height: 1,
    width: "100%",
    marginBottom: 20,
  },
  myStatusSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  myStatusLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  myStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 10,
  },
  myStatusText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  timeSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.02)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  timeColumn: {
    alignItems: "center",
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  timeValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  myNotesSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  myNotesText: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  clockButtonsContainer: {
    marginBottom: 12,
  },
  clockButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  clockButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  statusBannerText: {
    fontSize: 15,
    fontWeight: "600",
  },
  locationInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  locationText: {
    fontSize: 12,
  },
});
