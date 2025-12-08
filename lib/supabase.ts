import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const supabaseUrl =
  Constants.expoConfig?.extra?.SUPABASE_URL! ||
  "https://tglewsgmrjbepakwbsju.supabase.co";
const supabaseAnonKey =
  Constants.expoConfig?.extra?.SUPABASE_ANON_KEY! ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbGV3c2dtcmpiZXBha3dic2p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1MDM2NDIsImV4cCI6MjA2OTA3OTY0Mn0.R-wWpyggzKn0XwhpXFtOFBH18licCj-_nZrdI34Wj3Q";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
