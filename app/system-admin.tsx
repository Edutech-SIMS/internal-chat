import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
interface School {
  id: string;
  name: string;
  profiles: {
    id: string;
    email: string;
    role: string;
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

      // Validate file
      if (!file?.uri) {
        throw new Error("Invalid logo file: No URI found");
      }

      // Extract file extension
      const fileExt = file.uri.split(".").pop()?.toLowerCase();
      if (!fileExt) {
        throw new Error("Could not determine file extension");
      }

      // Use the correct file path (matching manual upload: school-logos/<schoolId>.<fileExt>)
      const fileName = `school-logos/${schoolId}.${fileExt}`;
      console.log("Uploading logo to path:", fileName);

      // Fetch and convert to blob
      const response = await fetch(file.uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const blob = await response.blob();
      console.log("Blob created successfully, size:", blob.size);

      // Optional: Check file size (e.g., max 5MB)
      if (blob.size > 5 * 1024 * 1024) {
        throw new Error("Logo file is too large (max 5MB)");
      }

      // Upload file to Supabase storage
      const { data, error } = await supabase.storage
        .from("assets") // Match your bucket name
        .upload(fileName, blob, {
          upsert: true,
          contentType: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
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

      // Verify the URL matches the expected format
      const expectedPrefix =
        "https://ovgkpnyyigipuwsgnjrn.supabase.co/storage/v1/object/public/assets/";
      if (!urlData.publicUrl.startsWith(expectedPrefix)) {
        console.warn("Generated URL may be incorrect:", urlData.publicUrl);
      }

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
      const { data, error } = await supabase
        .from("profiles")
        .select("is_system_admin")
        .eq("id", user.id)
        .single();

      if (error) throw error;

      if (!data?.is_system_admin) {
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
      const { data, error } = await supabase
        .from("schools")
        .select("id, name, profiles(id, email, role)")
        .order("name");

      if (error) throw error;
      setSchools(data || []);
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
    const admin = item.profiles?.find((p) => p.role === "admin");
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Header with Logout */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>System Administration</Text>
            <Text style={styles.subtitle}>
              Manage schools and administrators
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* Create School Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Create New School</Text>

          <TextInput
            placeholder="Internal Name"
            value={schoolName}
            onChangeText={setSchoolName}
            style={styles.input}
            editable={!creatingSchool}
          />

          <TextInput
            placeholder="Display Name"
            value={displayName}
            onChangeText={setDisplayName}
            style={styles.input}
            editable={!creatingSchool}
          />

          {/* Color Picker */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ marginBottom: 4 }}>Theme Color</Text>
            <TextInput
              value={themeColor}
              onChangeText={setThemeColor}
              placeholder="#4CAF50"
              style={styles.input}
            />
          </View>

          {/* Logo Picker */}
          <TouchableOpacity
            onPress={pickLogo}
            style={[styles.primaryButton, { marginBottom: 12 }]}
          >
            <Text style={styles.buttonText}>
              {logoFile ? "Change Logo" : "Upload Logo"}
            </Text>
          </TouchableOpacity>
          {logoFile && (
            <Text style={{ marginBottom: 12 }}>
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
              <Text style={styles.buttonText}>Create School</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Schools List Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schools ({schools.length})</Text>
          {fetchingSchools && !refreshing ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator color="#007AFF" />
              <Text style={styles.loadingText}>Loading schools...</Text>
            </View>
          ) : schools.length === 0 ? (
            <View style={styles.emptyState}>
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

const styles = {
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    backgroundColor: "#f8fafc",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: "#1e293b",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#1e293b",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#ffffff",
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center" as const,
    shadowColor: "#007AFF",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  disabledButton: {
    backgroundColor: "#94a3b8",
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600" as const,
    fontSize: 16,
  },
  schoolCard: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  schoolHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 12,
  },
  schoolName: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#1e293b",
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    fontWeight: "600" as const,
    color: "#059669",
  },
  adminInfo: {
    backgroundColor: "#f8fafc",
    padding: 16,
    borderRadius: 12,
  },
  adminLabel: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#64748b",
    marginBottom: 4,
  },
  adminEmail: {
    fontSize: 16,
    color: "#1e293b",
    fontWeight: "500" as const,
  },
  adminForm: {
    marginTop: 8,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#1e293b",
    marginBottom: 12,
  },
  createAdminButton: {
    backgroundColor: "#10b981",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center" as const,
  },
  loadingSection: {
    alignItems: "center" as const,
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#64748b",
  },
  emptyState: {
    alignItems: "center" as const,
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#64748b",
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#9ca3af",
  },
  header: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 32,
  },
  logoutButton: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: "#ef4444",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logoutButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600" as const,
  },
};
