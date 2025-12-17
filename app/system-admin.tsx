import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface UserRole {
  role: string;
}

interface School {
  id: string;
  name: string;
  profiles: {
    id: string;
    email: string;
    roles: UserRole[];
  }[];
}

interface AdminFormData {
  schoolId: string;
  email: string;
  password: string;
}

export default function SystemAdminPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  // Loading states
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // Schools data
  const [schools, setSchools] = useState<School[]>([]);
  const [fetchingSchools, setFetchingSchools] = useState(false);

  // School creation
  const [schoolName, setSchoolName] = useState(""); // the "internal" school name
  const [displayName, setDisplayName] = useState(""); // name shown in UI / school_settings.name
  const [themeColor, setThemeColor] = useState("#4CAF50"); // default
  const [logoFile, setLogoFile] = useState<any>(null); // picked file
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Admin creation
  const [adminForms, setAdminForms] = useState<Record<string, AdminFormData>>(
    {}
  );
  const [creatingAdmin, setCreatingAdmin] = useState<string | null>(null);

  // Initialize profile check
  useEffect(() => {
    checkSystemAdminStatus();
  }, [user]);

  const handleLogout = () => {
    Alert.alert("Confirm Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            router.replace("/(auth)/login");
          } catch (error) {
            console.error("Logout failed:", error);
            Alert.alert("Error", "Failed to logout. Please try again.");
          }
        },
      },
    ]);
  };

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setLogoFile(result.assets[0]); // store picked image
    }
  };

  const uploadLogo = async (file: any, schoolId: string) => {
    try {
      console.log("Logo file details:", file);

      if (!file?.uri) {
        throw new Error("Invalid logo file: No URI found");
      }

      const fileExt = file.uri.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `school-logos/${schoolId}.${fileExt}`;
      console.log("Uploading logo to path:", fileName);

      // Create FormData - this is the key difference
      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: fileName,
        type: file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
      } as any);

      // Upload using Supabase storage
      const { data, error } = await supabase.storage
        .from("assets")
        .upload(fileName, formData, {
          upsert: true,
          contentType:
            file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
        });

      if (error) {
        console.error("Upload error:", error);
        throw new Error(`Upload failed: ${error.message}`);
      }

      console.log("Upload successful:", data);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("assets")
        .getPublicUrl(fileName);

      if (!urlData?.publicUrl) {
        throw new Error("Failed to retrieve public URL");
      }

      console.log("Public URL:", urlData.publicUrl);
      return urlData.publicUrl;
    } catch (error: any) {
      console.error("uploadLogo error:", error);
      throw error;
    }
  };

  const handleCreateSchool = async () => {
    const trimmedInternalName = schoolName.trim();
    const trimmedDisplayName = displayName.trim();

    if (!trimmedInternalName || !trimmedDisplayName) {
      Alert.alert(
        "Validation Error",
        "Both internal name and display name are required."
      );
      return;
    }

    setCreatingSchool(true);

    try {
      // 1️⃣ Insert school
      const { data: schoolData, error: schoolError } = await supabase
        .from("schools")
        .insert([{ name: trimmedInternalName }])
        .select()
        .single();

      if (schoolError || !schoolData) {
        console.error("School creation error:", schoolError);
        throw schoolError || new Error("Failed to create school");
      }

      const schoolId = schoolData.id;
      console.log("School created, ID:", schoolId);

      // 2️⃣ Upload logo if provided
      let logo_url: string | null = null;
      if (logoFile) {
        console.log("Attempting to upload logo for school:", schoolId);
        try {
          logo_url = await uploadLogo(logoFile, schoolId);
          console.log("Logo uploaded, URL:", logo_url);
        } catch (uploadErr: any) {
          console.error("Logo upload failed:", uploadErr);
          Alert.alert(
            "Warning",
            `Failed to upload logo: ${uploadErr.message}. Proceeding without logo.`
          );
          // Continue without logo instead of failing
          logo_url = null;
        }
      } else {
        console.log("No logo provided, skipping upload");
      }

      // 3️⃣ Insert school settings
      const settingsPayload = {
        school_id: schoolId,
        name: trimmedDisplayName,
        theme_color: themeColor,
        logo_url, // Will be null if no logo or upload failed
      };
      console.log("Inserting school settings:", settingsPayload);

      const { error: settingsError } = await supabase
        .from("school_settings")
        .insert([settingsPayload]);

      if (settingsError) {
        console.error("Settings insertion error:", settingsError);
        throw settingsError;
      }

      console.log("School settings inserted successfully");
      Alert.alert(
        "Success",
        `School "${trimmedDisplayName}" created successfully!`
      );

      // Reset form
      setSchoolName("");
      setDisplayName("");
      setThemeColor("#4CAF50");
      setLogoFile(null);
      setShowCreateForm(false);

      await fetchSchools();
    } catch (err: any) {
      console.error("Error creating school or settings:", err);
      Alert.alert(
        "Error",
        err.message || "Failed to create school. Please try again."
      );
    } finally {
      setCreatingSchool(false);
    }
  };

  const checkSystemAdminStatus = async () => {
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }

    try {
      // Check if user has superadmin role instead of is_system_admin field
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (rolesError) throw rolesError;

      const isSuperAdmin =
        userRoles?.some((role) => role.role === "superadmin") || false;

      if (!isSuperAdmin) {
        Alert.alert("Unauthorized", "You are not a system admin.");
        router.replace("/school-splash");
        return;
      }

      setIsSystemAdmin(true);
      await fetchSchools();
    } catch (error: any) {
      console.error("Error checking admin status:", error);
      Alert.alert("Error", "Could not verify system admin status.");
      router.replace("/school-splash");
    } finally {
      setLoading(false);
    }
  };

  const fetchSchools = async () => {
    setFetchingSchools(true);
    try {
      // Optimized: Fetch schools with nested profiles and roles in a single query
      const { data: schoolsData, error } = await supabase
        .from("schools")
        .select(
          `
          id,
          name,
          profiles (
            id,
            email,
            roles:user_roles (
              role
            )
          )
        `
        )
        .order("name");

      if (error) throw error;

      // Transform the data to match the expected structure if necessary
      // The deep select returns the structure we need, but we might need to handle nulls
      const formattedSchools = (schoolsData || []).map((school) => ({
        ...school,
        profiles: school.profiles || [],
      }));

      setSchools(formattedSchools);
    } catch (error: any) {
      console.error("Error fetching schools:", error);
      Alert.alert("Error", "Failed to fetch schools.");
    } finally {
      setFetchingSchools(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchSchools();
    setRefreshing(false);
  };

  const updateAdminForm = (
    schoolId: string,
    field: keyof Omit<AdminFormData, "schoolId">,
    value: string
  ) => {
    setAdminForms((prev) => ({
      ...prev,
      [schoolId]: {
        schoolId,
        email: prev[schoolId]?.email || "",
        password: prev[schoolId]?.password || "",
        [field]: value,
      },
    }));
  };

  const getAdminForm = (schoolId: string): AdminFormData => {
    return adminForms[schoolId] || { schoolId, email: "", password: "" };
  };

  const handleCreateAdmin = async (schoolId: string) => {
    const form = getAdminForm(schoolId);

    if (!form.email.trim() || !form.password.trim()) {
      Alert.alert("Validation Error", "Email and password are required.");
      return;
    }

    if (form.password.length < 6) {
      Alert.alert(
        "Validation Error",
        "Password must be at least 6 characters."
      );
      return;
    }

    setCreatingAdmin(schoolId);
    try {
      const { error } = await supabase.functions.invoke("create-school-admin", {
        body: {
          email: form.email.trim(),
          password: form.password,
          school_id: schoolId,
        },
      });

      if (error) throw error;

      Alert.alert("Success", "School admin created successfully!");

      // Clear form for this school
      setAdminForms((prev) => {
        const updated = { ...prev };
        delete updated[schoolId];
        return updated;
      });

      await fetchSchools();
    } catch (err: any) {
      let message = "Failed to create admin.";

      if (err.name === "FunctionsHttpError") {
        try {
          const response = err.context;
          const bodyText = await response.text();
          const parsedBody = JSON.parse(bodyText);

          if (parsedBody.error) {
            message = parsedBody.error;
          }
        } catch (parseError) {
          console.error("Failed to parse error response:", parseError);
          if (err.message) {
            message = err.message;
          }
        }
      } else if (err.message) {
        message = err.message;
      }

      Alert.alert("Error", message);
    } finally {
      setCreatingAdmin(null);
    }
  };

  const renderSchoolCard = ({ item }: { item: School }) => {
    const admin = item.profiles?.find((p) =>
      p.roles?.some((r) => r.role === "admin")
    );
    const form = getAdminForm(item.id);
    const isCreatingThisAdmin = creatingAdmin === item.id;

    return (
      <View style={styles.schoolCard}>
        <View style={styles.schoolHeader}>
          <Text style={styles.schoolName}>{item.name}</Text>
          <View
            style={[
              styles.statusBadge,
              admin ? styles.activeStatus : styles.pendingStatus,
            ]}
          >
            <Text style={styles.statusText}>
              {admin ? "Active" : "Pending Admin"}
            </Text>
          </View>
        </View>

        {admin ? (
          <View style={styles.adminInfo}>
            <Text style={styles.adminLabel}>Administrator:</Text>
            <Text style={styles.adminEmail}>{admin.email}</Text>
          </View>
        ) : (
          <View style={styles.adminForm}>
            <Text style={styles.formTitle}>Create School Administrator</Text>

            <TextInput
              placeholder="Admin Email Address"
              value={form.email}
              onChangeText={(text) => updateAdminForm(item.id, "email", text)}
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!isCreatingThisAdmin}
            />

            <TextInput
              placeholder="Admin Password (min. 6 characters)"
              value={form.password}
              onChangeText={(text) =>
                updateAdminForm(item.id, "password", text)
              }
              style={styles.input}
              secureTextEntry
              editable={!isCreatingThisAdmin}
            />

            <TouchableOpacity
              onPress={() => handleCreateAdmin(item.id)}
              disabled={isCreatingThisAdmin}
              style={[
                styles.createAdminButton,
                isCreatingThisAdmin && styles.disabledButton,
              ]}
            >
              {isCreatingThisAdmin ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.buttonText}>Create Administrator</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Checking admin privileges...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>System Administration</Text>
          <Text style={styles.subtitle}>Manage schools and administrators</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={20} color="white" />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Quick Stats Card */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{schools.length}</Text>
            <Text style={styles.statLabel}>Total Schools</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {
                schools.filter((s) =>
                  s.profiles?.some((p) =>
                    p.roles?.some((r) => r.role === "admin")
                  )
                ).length
              }
            </Text>
            <Text style={styles.statLabel}>Active Schools</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {
                schools.filter(
                  (s) =>
                    !s.profiles?.some((p) =>
                      p.roles?.some((r) => r.role === "admin")
                    )
                ).length
              }
            </Text>
            <Text style={styles.statLabel}>Pending Setup</Text>
          </View>
        </View>

        {/* Create School Section - Collapsible */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setShowCreateForm(!showCreateForm)}
          >
            <Text style={styles.sectionTitle}>Create New School</Text>
            <Ionicons
              name={showCreateForm ? "chevron-up" : "chevron-down"}
              size={20}
              color="#64748b"
            />
          </TouchableOpacity>

          {showCreateForm && (
            <View style={styles.createForm}>
              <TextInput
                placeholder="Internal Name (for system use)"
                value={schoolName}
                onChangeText={setSchoolName}
                style={styles.input}
                editable={!creatingSchool}
              />

              <TextInput
                placeholder="Display Name (shown to users)"
                value={displayName}
                onChangeText={setDisplayName}
                style={styles.input}
                editable={!creatingSchool}
              />

              {/* Color Picker */}
              <View style={{ marginBottom: 12 }}>
                <Text style={styles.inputLabel}>Theme Color</Text>
                <TextInput
                  value={themeColor}
                  onChangeText={setThemeColor}
                  placeholder="#4CAF50"
                  style={styles.input}
                />
              </View>

              {/* Logo Picker */}
              <Text style={styles.inputLabel}>School Logo</Text>
              <TouchableOpacity
                onPress={pickLogo}
                style={[styles.secondaryButton, { marginBottom: 12 }]}
              >
                <Ionicons name="image-outline" size={16} color="#007AFF" />
                <Text style={styles.secondaryButtonText}>
                  {logoFile ? "Change Logo" : "Select Logo"}
                </Text>
              </TouchableOpacity>
              {logoFile && (
                <Text style={[styles.inputHelpText, { marginBottom: 12 }]}>
                  Selected: {logoFile.name || "Logo selected"}
                </Text>
              )}

              <TouchableOpacity
                onPress={handleCreateSchool}
                disabled={creatingSchool}
                style={[
                  styles.primaryButton,
                  creatingSchool && styles.disabledButton,
                ]}
              >
                {creatingSchool ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color="white"
                    />
                    <Text style={styles.buttonText}>Create School</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Schools List Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Schools ({schools.length})</Text>
            <TouchableOpacity
              onPress={fetchSchools}
              style={styles.refreshButton}
            >
              <Ionicons name="refresh" size={18} color="#007AFF" />
            </TouchableOpacity>
          </View>

          {fetchingSchools && !refreshing ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator color="#007AFF" />
              <Text style={styles.loadingText}>Loading schools...</Text>
            </View>
          ) : schools.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="school-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyStateText}>No schools created yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Create your first school above
              </Text>
            </View>
          ) : (
            <FlatList
              data={schools}
              keyExtractor={(item) => item.id}
              renderItem={renderSchoolCard}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    zIndex: 10,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1e293b",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
  },
  statsCard: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: "#007AFF",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#e2e8f0",
  },
  section: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
  },
  createForm: {
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: "#ffffff",
    fontSize: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  inputHelpText: {
    fontSize: 14,
    color: "#64748b",
    fontStyle: "italic" as const,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#007AFF",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "white",
  },
  disabledButton: {
    backgroundColor: "#94a3b8",
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 16,
  },
  secondaryButtonText: {
    color: "#007AFF",
    fontWeight: "600",
    fontSize: 16,
  },
  schoolCard: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  schoolHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  schoolName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  activeStatus: {
    backgroundColor: "#dcfce7",
  },
  pendingStatus: {
    backgroundColor: "#fef3c7",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#059669",
  },
  adminInfo: {
    backgroundColor: "#f8fafc",
    padding: 12,
    borderRadius: 8,
  },
  adminLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 4,
  },
  adminEmail: {
    fontSize: 14,
    color: "#1e293b",
    fontWeight: "500",
  },
  adminForm: {
    marginTop: 8,
  },
  formTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 12,
  },
  createAdminButton: {
    backgroundColor: "#10b981",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  loadingSection: {
    alignItems: "center",
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#64748b",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 12,
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#9ca3af",
  },
  logoutButton: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logoutButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  refreshButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
  },
});
