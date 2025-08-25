import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Profile {
  id: string;
  full_name: string | null;
  role: string | null;
  avatar_url?: string | null;
  school_id?: string | null; // add this
}

interface AuthContextType {
  user: User | null; // only auth user (id/email)
  session: Session | null;
  loading: boolean;
  profile: Profile | null; // full profile data
  isAdmin: boolean;
  schoolId: string | number | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  profile: null,
  isAdmin: false,
  schoolId: null,
  refreshProfile: async () => {},
  signOut: async () => {},
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
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, school_id")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (err) {
      console.error("Error fetching profile:", err);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setProfile(null);
    } catch (err) {
      console.error("Error signing out:", err);
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
        isAdmin: profile?.role === "admin",
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
