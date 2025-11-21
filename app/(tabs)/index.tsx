import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { EventRegister } from "react-native-event-listeners";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

interface Chat {
  id: string;
  name: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  is_group: boolean;
  is_announcement?: boolean;
}

export default function ChatsScreen() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { user, profile } = useAuth();

  // Run once on mount
  useEffect(() => {
    fetchChats();

    // Listen for refresh events
    const listener = EventRegister.addEventListener("refreshChats", () => {
      fetchChats();
    });

    return () => {
      if (listener && typeof listener === "string") {
        EventRegister.removeEventListener(listener);
      }
    };
  }, []);

  // Run quietly whenever tab/screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchChats();
    }, [user?.id])
  );

  const fetchChats = async () => {
    if (!user?.id || !profile?.school_id) return;

    setLoading(true);

    try {
      // Get all groups for this user in their school (server-side filter)
      const { data: userGroups, error: groupError } = await supabase
        .from("group_members")
        .select(
          `
        group_id,
        groups!inner (
          id,
          name,
          is_announcement,
          created_at,
          school_id,
          description
        )
      `
        )
        .eq("user_id", user.id)
        .eq("groups.school_id", profile.school_id)
        .order("joined_at", { ascending: false });

      if (groupError) throw groupError;

      if (!userGroups || userGroups.length === 0) {
        setChats([]);
        setLoading(false);
        return;
      }

      const groupIds = userGroups.map((g) => g.group_id);

      // Get latest message per group
      const { data: latestMessages, error: messageError } = await supabase
        .from("messages")
        .select(`id, content, created_at, group_id`)
        .in("group_id", groupIds)
        .order("created_at", { ascending: false });

      if (messageError) throw messageError;

      const messageMap = new Map<string, any>();
      latestMessages?.forEach((msg) => {
        if (!messageMap.has(msg.group_id)) messageMap.set(msg.group_id, msg);
      });

      // Format chats
      const formattedChats: Chat[] = userGroups.map((userGroup: any) => {
        const group = userGroup.groups;
        const latestMessage = messageMap.get(group.id);

        return {
          id: group.id,
          name: group.name || "Untitled Group",
          last_message: latestMessage?.content || "No messages yet",
          last_message_time: latestMessage?.created_at || group.created_at,
          unread_count: 0,
          is_group: true,
          is_announcement: group.is_announcement,
        };
      });

      setChats(formattedChats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      setChats([]);
    } finally {
      setLoading(false);
    }
  };

  const navigateToChat = (chatId: string, chatName: string) => {
    router.push(
      `/chat/${chatId}?name=${encodeURIComponent(chatName || "Chat")}`
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <View style={styles.spinner} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Conversations</Text>
          <Text style={styles.subtitle}>{chats.length} active chats</Text>
        </View>

        {chats.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.iconContainer}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={64}
                color="#007AFF"
              />
            </View>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtitle}>
              You&apos;re not part of any groups yet.{"\n"}Join a group to start
              chatting!
            </Text>
          </View>
        ) : (
          <FlatList
            data={chats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.chatItem}
                onPress={() => navigateToChat(item.id, item.name)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.avatar,
                    item.is_announcement && styles.announcementAvatar,
                  ]}
                >
                  <Ionicons
                    name={item.is_group ? "people" : "person"}
                    size={24}
                    color="#fff"
                  />
                </View>
                <View style={styles.chatContent}>
                  <View style={styles.chatHeader}>
                    <Text style={styles.chatName} numberOfLines={1}>
                      {item.name || "Untitled Chat"}
                    </Text>
                    {item.is_announcement && (
                      <View style={styles.badge}>
                        <Ionicons name="lock-closed" size={12} color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {item.last_message || "No messages"}
                  </Text>
                </View>

                <View style={styles.chatMeta}>
                  <Text style={styles.time}>
                    {item.last_message_time
                      ? new Date(item.last_message_time).toLocaleTimeString(
                          [],
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )
                      : "--:--"}
                  </Text>
                  {item.unread_count > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{item.unread_count}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "#007AFF",
    borderTopColor: "transparent",
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#f0f8ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 20,
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 30,
    lineHeight: 22,
  },
  chatItem: {
    flexDirection: "row",
    padding: 15,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  announcementAvatar: {
    backgroundColor: "#ff6b35",
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  badge: {
    backgroundColor: "#ff6b35",
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  lastMessage: {
    fontSize: 14,
    color: "#666",
  },
  chatMeta: {
    alignItems: "flex-end",
  },
  time: {
    fontSize: 12,
    color: "#999",
    marginBottom: 5,
  },
  unreadBadge: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  unreadText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginLeft: 80,
  },
});
