import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ThemedText as Text } from "../components/ThemedText";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { getThemeColors } from "../themes";

interface Student {
  student_id: string;
  student_name: string;
}

interface AbsenceRequestModalProps {
  visible: boolean;
  onClose: () => void;
  students: Student[];
  onSuccess: () => void;
}

export default function AbsenceRequestModal({
  visible,
  onClose,
  students,
  onSuccess,
}: AbsenceRequestModalProps) {
  const { user } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  const [loading, setLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    students.length === 1 ? students[0].student_id : ""
  );
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null
  );

  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const handleFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setFile(result.assets[0]);
    } catch (error) {
      console.error("Error picking file:", error);
      Alert.alert("Error", "Failed to pick file");
    }
  };

  const handleSubmit = async () => {
    if (!selectedStudentId || !reason) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    if (endDate < startDate) {
      Alert.alert("Error", "End date cannot be before start date");
      return;
    }

    try {
      setLoading(true);

      // Check for duplicate requests
      const { data: existingRequests, error: checkError } = await supabase
        .from("absence_requests")
        .select("id")
        .eq("student_id", selectedStudentId)
        .in("status", ["pending", "approved"])
        .gte("end_date", startDate.toISOString().split("T")[0])
        .lte("start_date", endDate.toISOString().split("T")[0]);

      if (checkError) throw checkError;

      if (existingRequests && existingRequests.length > 0) {
        Alert.alert(
          "Duplicate Request",
          "You already have a pending or approved absence request for these dates."
        );
        setLoading(false);
        return;
      }

      let attachmentUrl = null;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${user?.id}/${Date.now()}.${fileExt}`;

        // Read file as blob
        const response = await fetch(file.uri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from("absence_proofs")
          .upload(fileName, blob);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("absence_proofs")
          .getPublicUrl(fileName);

        attachmentUrl = publicUrlData.publicUrl;
      }

      // Get school_id from student record (we might need to fetch it or pass it)
      // Assuming we can get it from the current user profile or fetch it.
      // For now, let's fetch the student's school_id to be safe, or use the profile's school_id if parent is in same school.
      // Actually, the parent might have kids in different schools?
      // Let's fetch the student's school_id.
      const { data: studentData, error: studentError } = await supabase
        .from("students")
        .select("school_id")
        .eq("id", selectedStudentId)
        .single();

      if (studentError) throw studentError;

      const { error: insertError } = await supabase
        .from("absence_requests")
        .insert({
          student_id: selectedStudentId,
          parent_id: user?.id,
          school_id: studentData.school_id,
          start_date: startDate.toISOString().split("T")[0],
          end_date: endDate.toISOString().split("T")[0],
          reason,
          attachment_url: attachmentUrl,
          status: "pending",
        });

      if (insertError) throw insertError;

      Alert.alert("Success", "Absence request submitted successfully");
      onSuccess();
      handleClose();
    } catch (error: any) {
      console.error("Error submitting request:", error);
      Alert.alert("Error", error.message || "Failed to submit request");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setFile(null);
    setStartDate(new Date());
    setEndDate(new Date());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            Request Absence
          </Text>
          <TouchableOpacity onPress={handleClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.form}>
          {/* Student Selection */}
          <Text style={[styles.label, { color: colors.text }]}>Student</Text>
          <View style={styles.studentSelector}>
            {students.map((student) => (
              <TouchableOpacity
                key={student.student_id}
                style={[
                  styles.studentOption,
                  {
                    backgroundColor:
                      selectedStudentId === student.student_id
                        ? colors.primary + "20"
                        : "transparent",
                    borderWidth:
                      selectedStudentId === student.student_id ? 2 : 1,
                    borderColor:
                      selectedStudentId === student.student_id
                        ? colors.primary
                        : colors.border,
                  },
                ]}
                onPress={() => setSelectedStudentId(student.student_id)}
              >
                <Text
                  style={[
                    styles.studentOptionText,
                    {
                      color:
                        selectedStudentId === student.student_id
                          ? colors.primary
                          : colors.text,
                    },
                  ]}
                >
                  {student.student_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Dates */}
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={[styles.label, { color: colors.text }]}>
                Start Date
              </Text>
              <TouchableOpacity
                style={[
                  styles.dateInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setShowStartDatePicker(true)}
              >
                <Text style={{ color: colors.text }}>
                  {startDate.toLocaleDateString()}
                </Text>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={colors.placeholderText}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.dateField}>
              <Text style={[styles.label, { color: colors.text }]}>
                End Date
              </Text>
              <TouchableOpacity
                style={[
                  styles.dateInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setShowEndDatePicker(true)}
              >
                <Text style={{ color: colors.text }}>
                  {endDate.toLocaleDateString()}
                </Text>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={colors.placeholderText}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Date Pickers */}
          {showStartDatePicker && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event, date) => {
                setShowStartDatePicker(false);
                if (date) setStartDate(date);
              }}
            />
          )}
          {showEndDatePicker && (
            <DateTimePicker
              value={endDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event, date) => {
                setShowEndDatePicker(false);
                if (date) setEndDate(date);
              }}
              minimumDate={startDate}
            />
          )}

          {/* Reason */}
          <Text style={[styles.label, { color: colors.text }]}>Reason</Text>
          <TextInput
            style={[
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder="Please provide details..."
            placeholderTextColor={colors.placeholderText}
            multiline
            numberOfLines={4}
            value={reason}
            onChangeText={setReason}
          />

          {/* File Attachment */}
          <Text style={[styles.label, { color: colors.text }]}>
            Attachment (Optional)
          </Text>
          <TouchableOpacity
            style={[
              styles.fileInput,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
              },
            ]}
            onPress={handleFilePick}
          >
            <Ionicons
              name={file ? "document" : "cloud-upload-outline"}
              size={24}
              color={colors.primary}
            />
            <Text
              style={[
                styles.fileText,
                { color: file ? colors.text : colors.placeholderText },
              ]}
              numberOfLines={1}
            >
              {file ? file.name : "Upload doctor's note, letter, etc."}
            </Text>
            {file && (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={colors.placeholderText}
                />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              loading && styles.disabledButton,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Request</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  form: {
    width: "100%",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 12,
  },
  studentSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  studentOption: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  studentOptionText: {
    fontSize: 14,
    fontWeight: "500",
  },
  dateRow: {
    flexDirection: "row",
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  dateInput: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  textArea: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    height: 100,
    textAlignVertical: "top",
  },
  fileInput: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: 10,
  },
  fileText: {
    flex: 1,
    fontSize: 14,
  },
  submitButton: {
    marginTop: 30,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  disabledButton: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});
