import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

interface School {
  school_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  theme_color: string;
  logo_url: string;
  latitude: number | null;
  longitude: number | null;
  settings: any;
}

interface UserRole {
  id: string;
  user_id: string;
  role: string; // This will be of type app_role in the database
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  avatar_url?: string | null;
  school_id?: string | null;
  user_id?: string; // Added user_id field
  // Removed is_system_admin since we're using roles now
  roles?: UserRole[]; // New field for user roles
}

interface AuthContextType {
  user: User | null; // only auth user (id/email)
  session: Session | null;
  loading: boolean;
  profile: Profile | null; // full profile data
  school: School | null; // school information
  isAdmin: boolean;
  schoolId: string | number | null;
  refreshProfile: () => Promise<void>;
  refreshSchool: () => Promise<void>; // new function to refresh school data
  signIn: (
    email: string,
    password: string,
    expoPushToken?: string
  ) => Promise<any>;
  signUp: (email: string, password: string, fullName: string) => Promise<any>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  hasRole: (role: string) => boolean; // New helper function
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  profile: null,
  school: null, // default school value
  isAdmin: false,
  schoolId: null,
  refreshProfile: async () => { },
  refreshSchool: async () => { }, // default refreshSchool function
  signIn: async () => { },
  signUp: async () => { },
  signOut: async () => { },
  resetPassword: async () => { },
  updatePassword: async () => { },
  hasRole: () => false,
});

export const useAuth = () => useContext(AuthContext);

// New hook to access school information
export const useSchool = () => {
  const context = useContext(AuthContext);
  return {
    school: context.school,
    schoolId: context.schoolId,
    refreshSchool: context.refreshSchool,
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [school, setSchool] = useState<School | null>(null); // new state for school
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        await fetchProfile(data.session.user.id);
      }

      setLoading(false);
    };

    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }

        setLoading(false);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    console.log("Fetching profile for user", { userId });

    try {
      // Fetch profile data with roles and school in a single query
      console.log("Fetching profile, roles, and school data", { userId });
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select(`
          *,
          roles:user_roles(*),
          school:schools(*)
        `)
        .eq("user_id", userId)
        .single();

      if (profileError) {
        console.error("Failed to fetch profile data", {
          userId,
          error: profileError.message,
        });
        throw profileError;
      }

      console.log("Profile data fetched successfully", {
        userId,
        profileId: profileData.id,
        fullName: profileData.full_name,
        roleCount: profileData.roles?.length || 0,
        schoolName: profileData.school?.name,
      });

      // Transform to match expected state shape
      const profileWithRoles = {
        ...profileData,
        roles: profileData.roles || [],
      };

      setProfile(profileWithRoles);

      // Set school state if available
      if (profileData.school) {
        setSchool(profileData.school);
      } else {
        setSchool(null);
      }

      console.log("Profile and school state updated successfully", { userId });
    } catch (err) {
      console.error("Error fetching profile", { userId, error: err });
      setProfile(null);
      setSchool(null);
    }
  };

  // New function to fetch school information (kept for standalone usage if needed)
  const fetchSchool = async (schoolId: string) => {
    try {
      console.log("Fetching school information", { schoolId });
      const { data: schoolData, error: schoolError } = await supabase
        .from("schools")
        .select(
          "school_id, name, created_at, updated_at, theme_color, logo_url, latitude, longitude, settings"
        )
        .eq("school_id", schoolId)
        .single();

      if (schoolError) {
        console.error("Failed to fetch school data", {
          schoolId,
          error: schoolError.message,
        });
        throw schoolError;
      }

      setSchool(schoolData);
    } catch (err) {
      console.error("Error fetching school", { schoolId, error: err });
      setSchool(null);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  // New function to refresh school data
  const refreshSchool = async () => {
    if (profile?.school_id) await fetchSchool(profile.school_id);
  };

  // Helper function to check if user has a specific role
  const hasRole = (role: string): boolean => {
    if (!profile?.roles) return false;
    return profile.roles.some((userRole) => userRole.role === role);
  };

  const signIn = async (
    email: string,
    password: string,
    expoPushToken?: string
  ) => {
    console.log("SignIn function called", { email });

    if (!email || !password) {
      const errorMsg = "Please enter both email and password.";
      console.warn("SignIn validation failed", { email, errorMsg });
      throw new Error(errorMsg);
    }

    setLoading(true);

    try {
      console.log("Attempting to sign in with Supabase", { email });
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        console.error("Supabase authentication failed", {
          email,
          error: authError.message,
        });
        throw new Error(authError.message);
      }

      if (!authData?.user) {
        const errorMsg = "No user returned from Supabase.";
        console.error("SignIn failed - no user returned", { email, errorMsg });
        throw new Error(errorMsg);
      }

      console.log("Supabase authentication successful", {
        userId: authData.user.id,
        email,
      });

      // Update auth state immediately
      setUser(authData.user);
      setSession(authData.session);

      // Fetch profile, roles, and school in one go
      await fetchProfile(authData.user.id);

      // We need to get the profile from state or re-fetch it to return it?
      // Since setState is async, we can't rely on 'profile' state being updated immediately for the return value.
      // However, fetchProfile already fetched it. To avoid double fetching, we can just return what we have if needed,
      // but the context consumers should rely on the context state, not the return value of signIn.
      // But for push token registration we need the profile data.

      // Let's re-fetch just for the local logic (it will be fast/cached or we can just use the logic from fetchProfile here if we want to be super optimized, 
      // but calling fetchProfile is cleaner code. To get the data for push token, we can just query it again or refactor fetchProfile to return data.)

      // Refactoring fetchProfile to return data would be best, but to minimize changes let's just query what we need for push token if it's missing.
      // Actually, let's just trust fetchProfile did its job.

      // Push token registration
      if (expoPushToken) {
        // We need the profile data we just fetched. 
        // Let's just do a quick check or assume fetchProfile succeeded.
        // Ideally fetchProfile should return the data.

        // Let's modify fetchProfile above to return the data? 
        // No, let's just do the push token logic inside fetchProfile? No, that's side effect.

        // For now, let's just fetch the minimal info needed for push token if we have a token
        const { data: minimalProfile } = await supabase
          .from("profiles")
          .select("id, school_id")
          .eq("user_id", authData.user.id)
          .single();

        if (minimalProfile?.id && minimalProfile?.school_id) {
          try {
            await supabase.from("user_push_tokens").upsert(
              {
                user_id: minimalProfile.id,
                school_id: minimalProfile.school_id,
                token: expoPushToken,
                device_platform: Platform.OS,
              },
              { onConflict: "user_id,school_id,token" }
            );
          } catch (err) {
            console.error("Failed to save push token", err);
          }
        }
      }

      return {
        user: authData.user,
        // profile: ... we don't strictly need to return profile here if components use useAuth()
      };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      // Create profile record if signup was successful
      if (data.user) {
        const { error: profileError } = await supabase.from("profiles").insert({
          user_id: data.user.id,
          full_name: fullName,
          // Note: Roles will be assigned separately, possibly by admin
        });

        if (profileError) {
          console.error("Error creating profile:", profileError);
        }
      }

      return data;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    console.log("Sign out initiated");

    try {
      await supabase.auth.signOut();
      console.log("Supabase sign out successful");

      setUser(null);
      setSession(null);
      setProfile(null);

      console.log("Authentication state cleared successfully");
    } catch (err) {
      console.error("Error signing out", { error: err });
      throw err;
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);

    try {
      // Note: In React Native, we can't use window.location.origin
      // You might want to configure this URL in your environment variables
      const redirectTo =
        process.env.EXPO_PUBLIC_RESET_PASSWORD_REDIRECT || "exp://";

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        throw new Error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async (password: string) => {
    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw new Error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        profile,
        school, // expose school information
        schoolId: profile?.school_id ?? null,
        isAdmin: hasRole("admin"), // Check for admin role instead of profile.role
        refreshProfile,
        refreshSchool, // expose refreshSchool function
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        hasRole, // Expose the helper function
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
