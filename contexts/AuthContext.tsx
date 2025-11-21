import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

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
  isAdmin: boolean;
  schoolId: string | number | null;
  refreshProfile: () => Promise<void>;
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
  isAdmin: false,
  schoolId: null,
  refreshProfile: async () => {},
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  resetPassword: async () => {},
  updatePassword: async () => {},
  hasRole: () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
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
      // Fetch profile data
      console.log("Fetching profile data from profiles table", { userId });
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, school_id, user_id") // Added user_id to select
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
      });

      // Fetch user roles
      console.log("Fetching user roles from user_roles table", { userId });
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("id, user_id, role, created_at")
        .eq("user_id", userId);

      if (rolesError) {
        console.error("Failed to fetch user roles", {
          userId,
          error: rolesError.message,
        });
        throw rolesError;
      }

      console.log("User roles fetched successfully", {
        userId,
        roleCount: userRoles?.length || 0,
        roles: userRoles?.map((r) => r.role),
      });

      // Combine profile data with roles
      const profileWithRoles = {
        ...profileData,
        roles: userRoles || [],
      };

      setProfile(profileWithRoles);
      console.log("Profile state updated successfully", { userId });
    } catch (err) {
      console.error("Error fetching profile", { userId, error: err });
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
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

      // Fetch profile with roles
      console.log("Fetching user profile", { userId: authData.user.id });
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, school_id, user_id") // Added user_id to select
        .eq("user_id", authData.user.id)
        .single();

      if (profileError) {
        console.error("Failed to fetch user profile", {
          userId: authData.user.id,
          error: profileError.message,
        });
        throw new Error(profileError.message);
      }

      console.log("User profile fetched successfully", {
        userId: authData.user.id,
        profileId: profileData.id,
        fullName: profileData.full_name,
      });

      // Fetch user roles
      console.log("Fetching user roles", { userId: authData.user.id });
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("id, user_id, role, created_at")
        .eq("user_id", authData.user.id);

      if (rolesError) {
        console.error("Failed to fetch user roles", {
          userId: authData.user.id,
          error: rolesError.message,
        });
        throw new Error(rolesError.message);
      }

      console.log("User roles fetched successfully", {
        userId: authData.user.id,
        roleCount: userRoles?.length || 0,
        roles: userRoles?.map((r) => r.role),
      });

      const profileWithRoles = {
        ...profileData,
        roles: userRoles || [],
      };

      // Push token registration if available
      if (expoPushToken && profileData.id && profileData.school_id) {
        console.log("Attempting to register push token", {
          userId: profileData.id,
          schoolId: profileData.school_id,
        });

        try {
          await supabase.from("user_push_tokens").upsert(
            {
              user_id: profileData.id,
              school_id: profileData.school_id,
              token: expoPushToken,
              device_platform: Platform.OS,
            },
            { onConflict: "user_id,school_id,token" }
          );
          console.log("Push token registered successfully", {
            userId: profileData.id,
            schoolId: profileData.school_id,
          });
        } catch (err) {
          console.error("Failed to save push token", {
            userId: profileData.id,
            schoolId: profileData.school_id,
            error: err,
          });
        }
      }

      // Update local state
      setUser(authData.user);
      setSession(authData.session);
      setProfile(profileWithRoles);

      console.log("Authentication state updated successfully", {
        userId: authData.user.id,
      });

      return {
        user: authData.user,
        profile: profileWithRoles,
        // Removed isSystemAdmin since we're now checking for superadmin role
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
        schoolId: profile?.school_id ?? null,
        isAdmin: hasRole("admin"), // Check for admin role instead of profile.role
        refreshProfile,
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
