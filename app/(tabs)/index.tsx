import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  SafeAreaView,
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
  const { user } = useAuth();



  // Run once on mount
  useEffect(() => {
    fetchChats();
  }, []);

  // Run quietly whenever tab/screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchChats();
    }, [user?.id])
  );

  const fetchChats = async () => {
    try {
      const { data: userGroups, error } = await supabase
        .from("group_members")
        .select(
          `
          group_id,
          groups (
            id,
            name,
            is_announcement,
            created_at,
            description
          )
        `
        )
        .eq("user_id", user?.id)
        .order("joined_at", { ascending: false });

      if (error) {
        console.error("Error fetching user groups:", error);
        return;
      }

      if (!userGroups || userGroups.length === 0) {
        setChats([]);
        setLoading(false);
        return;
      }

      const groupIds = userGroups.map((g) => g.group_id);

      const { data: latestMessages } = await supabase
        .from("messages")
        .select(`id, content, created_at, group_id`)
        .in("group_id", groupIds)
        .order("created_at", { ascending: false });

      const messageMap = new Map();
      if (latestMessages) {
        latestMessages.forEach((msg) => {
          if (!messageMap.has(msg.group_id)) {
            messageMap.set(msg.group_id, msg);
          }
        });
      }

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
    } finally {
      setLoading(false);
    }
  };

  const navigateToChat = (chatId: string, chatName: string) => {
    router.push(`/chat/${chatId}?name=${encodeURIComponent(chatName || "Chat")}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text>Loading chats...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (chats.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubble-ellipses-outline" size={80} color="#ccc" />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySubtitle}>
            Join some groups to start chatting with your team!
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => router.push("/(tabs)/groups")}
          >
            <Text style={styles.browseButtonText}>Browse Groups</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chatItem}
              onPress={() => navigateToChat(item.id, item.name)}
            >
              <View style={styles.avatar}>
                <Ionicons
                  name={item.is_group ? "people" : "person"}
                  size={24}
                  color="#666"
                />
              </View>
              <View style={styles.chatContent}>
                <Text style={styles.chatName}>{item.name || "Untitled Chat"}</Text>
                <Text style={styles.lastMessage} numberOfLines={1}>
                  {item.last_message || "No messages"}
                </Text>
              </View>
              <View style={styles.chatMeta}>
                <Text style={styles.time}>
                  {item.last_message_time ? 
                    new Date(item.last_message_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }) : "--:--"
                  }
                </Text>
                {item.unread_count > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{item.unread_count}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
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
  browseButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  browseButtonText: {
    color: "white",
    fontWeight: "600",
  },
  chatItem: {
    flexDirection: "row",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    alignItems: "center",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  chatContent: {
    flex: 1,
  },
  chatName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
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
});