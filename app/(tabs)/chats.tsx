import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { EventRegister } from "react-native-event-listeners";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
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
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();

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

      // Fetch latest message for each group individually (N+1 pattern but limited to 1 row per group)
      // This is much more scalable than fetching ALL messages for ALL groups
      const chatsWithMessages = await Promise.all(
        userGroups.map(async (userGroup: any) => {
          const group = userGroup.groups;
          
          const { data: latestMessages, error: messageError } = await supabase
            .from("messages")
            .select(`id, content, created_at`)
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (messageError) {
            console.error(`Error fetching latest message for group ${group.id}:`, messageError);
            return {
              id: group.id,
              name: group.name || "Untitled Group",
              last_message: "Error loading message",
              last_message_time: group.created_at,
              unread_count: 0,
              is_group: true,
              is_announcement: group.is_announcement,
            };
          }

          const latestMessage = latestMessages?.[0];

          return {
            id: group.id,
            name: group.name || "Untitled Group",
            last_message: latestMessage?.content || "No messages yet",
            last_message_time: latestMessage?.created_at || group.created_at,
            unread_count: 0,
            is_group: true,
            is_announcement: group.is_announcement,
          };
        })
      );

      // Sort chats by last message time
      const sortedChats = chatsWithMessages.sort((a, b) => {
        return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
      });

      setChats(sortedChats);
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

  const filteredChats = chats.filter(
    (chat) =>
      chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.last_message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.safeArea, isDarkMode && styles.darkSafeArea]}
      >
        <View style={styles.loadingContainer}>
          <View style={styles.spinner} />
          <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>
            Loading conversations...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.darkSafeArea]}>
      <View style={[styles.container, isDarkMode && styles.darkContainer]}>
        <View style={[styles.header, isDarkMode && styles.darkHeader]}>
          <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>
            Chats
          </Text>
        
        </View>

        {/* Search Bar */}
        <View
          style={[
            styles.searchContainer,
            isDarkMode && styles.darkSearchContainer,
          ]}
        >
          <Ionicons
            name="search"
            size={20}
            color={isDarkMode ? "#aaa" : "#666"}
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.searchInput, isDarkMode && styles.darkSearchInput]}
            placeholder="Search chats..."
            placeholderTextColor={isDarkMode ? "#888" : "#999"}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
        </View>

        {chats.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View
              style={[
                styles.iconContainer,
                isDarkMode && styles.darkIconContainer,
              ]}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={64}
                color={isDarkMode ? "#4d9eff" : "#007AFF"}
              />
            </View>
            <Text style={[styles.emptyTitle, isDarkMode && styles.darkText]}>
              No conversations yet
            </Text>
            <Text style={[styles.emptySubtitle, isDarkMode && styles.darkText]}>
              You&apos;re not part of any groups yet.{"\n"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.chatItem, isDarkMode && styles.darkChatItem]}
                onPress={() => navigateToChat(item.id, item.name)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.avatar,
                    item.is_announcement && styles.announcementAvatar,
                    isDarkMode && styles.darkAvatar,
                  ]}
                >
                  <Ionicons
                    name={item.is_group ? "people" : "person"}
                    size={24}
                    color={isDarkMode ? "#121212" : "#fff"}
                  />
                </View>
                <View style={styles.chatContent}>
                  <View style={styles.chatHeader}>
                    <Text
                      style={[styles.chatName, isDarkMode && styles.darkText]}
                      numberOfLines={1}
                    >
                      {item.name || "Untitled Chat"}
                    </Text>
                    {item.is_announcement && (
                      <View style={styles.badge}>
                        <Ionicons name="lock-closed" size={12} color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.lastMessage,
                      isDarkMode && styles.darkLastMessage,
                    ]}
                    numberOfLines={1}
                  >
                    {item.last_message || "No messages"}
                  </Text>
                </View>

                <View style={styles.chatMeta}>
                  <Text style={[styles.time, isDarkMode && styles.darkTime]}>
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
            ItemSeparatorComponent={() => (
              <View
                style={[styles.separator, isDarkMode && styles.darkSeparator]}
              />
            )}
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
  darkSafeArea: {
    backgroundColor: "#121212",
  },
  container: {
    flex: 1,
  },
  darkContainer: {
    backgroundColor: "#121212",
  },
  header: {
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  darkHeader: {
    backgroundColor: "#1e1e1e",
    borderBottomColor: "#333",
  },
  headerTitle: {
    fontSize: 35,
    fontWeight: "700",
    color: "#333",
  },
  darkText: {
    color: "#fff",
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
  darkIconContainer: {
    backgroundColor: "#1e1e1e",
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
  darkChatItem: {
    backgroundColor: "#1e1e1e",
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
  darkAvatar: {
    backgroundColor: "#4d9eff",
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
  darkLastMessage: {
    color: "#aaa",
  },
  chatMeta: {
    alignItems: "flex-end",
  },
  time: {
    fontSize: 12,
    color: "#999",
    marginBottom: 5,
  },
  darkTime: {
    color: "#888",
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
  darkSeparator: {
    backgroundColor: "#333",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  darkSearchContainer: {
    backgroundColor: "#1e1e1e",
    borderBottomColor: "#333",
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#333",
  },
  darkSearchInput: {
    color: "#fff",
  },
});
