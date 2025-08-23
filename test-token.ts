// test-token.ts (run this in your app first to get a token)
import { supabase } from "./lib/supabase";

async function getTestToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  console.log("Token:", session?.access_token);
}

getTestToken();
