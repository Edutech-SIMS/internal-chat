import { supabase } from "./supabase";

export const canSendMessages = async (
  groupId: string,
  userId: string
): Promise<boolean> => {
  try {
    // Check if user is admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profile?.role === "admin") {
      return true; // Admins can always send messages
    }

    // Check group type
    const { data: group } = await supabase
      .from("groups")
      .select("is_announcement")
      .eq("id", groupId)
      .single();

    if (!group) return false;

    if (!group.is_announcement) {
      return true; // Public groups allow everyone to send messages
    }

    // For announcement groups, check permissions
    const { data: permission } = await supabase
      .from("group_message_permissions")
      .select("can_send_messages")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .single();

    return permission?.can_send_messages || false;
  } catch (error) {
    console.error("Error checking message permissions:", error);
    return false;
  }
};
