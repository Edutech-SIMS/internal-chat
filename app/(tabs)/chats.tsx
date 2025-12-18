import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { EventRegister } from "react-native-event-listeners";
import { SafeAreaView } from "react-native-safe-area-context";
import { getThemeColors } from "themes";
import { ThemedText as Text } from "../../components/ThemedText";
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
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewingChat, setPreviewingChat] = useState<Chat | null>(null);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const router = useRouter();
  const { user, profile } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

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

  // Handle real-time updates
  useEffect(() => {
    if (!user?.id || !profile?.school_id || chats.length === 0) return;

    console.log("[Chats] Setting up global real-time subscription");

    // Subscribe to messages in any group the user is a member of
    const groupIds = chats.map((c) => c.id);
    const channel = supabase.channel("global-chats");

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `school_id=eq.${profile.school_id}`,
        },
        (payload: any) => {
          if (groupIds.includes(payload.new.group_id)) {
            console.log(
              "[Chats] New message received for group:",
              payload.new.group_id
            );
            // Refresh counts and previews
            // We could update state manually for speed, but fetchChats is safer to ensure consistency
            fetchChats(true);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_reads",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          console.log("[Chats] Read status updated for user");
          fetchChats(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.school_id, chats.length > 0]);

  // Run quietly whenever tab/screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchChats(true);
    }, [user?.id])
  );

  const fetchChats = async (isRefreshing = false) => {
    if (!user?.id || !profile?.school_id) return;

    if (!isRefreshing && chats.length === 0) setLoading(true);

    try {
      // 1. Get all groups for this user
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
            school_id
          )
        `
        )
        .eq("user_id", user.id)
        .eq("groups.school_id", profile.school_id);

      if (groupError) throw groupError;
      if (!userGroups || userGroups.length === 0) {
        setChats([]);
        return;
      }

      const groupIds = userGroups.map((g) => g.group_id);

      // 2. Fetch last read timestamps for these groups
      const { data: readStatuses } = await supabase
        .from("group_reads")
        .select("group_id, last_read_at")
        .eq("user_id", user.id)
        .in("group_id", groupIds);

      const readMap = new Map(
        readStatuses?.map((r) => [r.group_id, r.last_read_at])
      );

      // 3. Fetch latest message AND unread count for each group
      const chatsWithData = await Promise.all(
        userGroups.map(async (ug: any) => {
          const group = ug.groups;
          const lastRead = readMap.get(group.id) || group.created_at;

          // Latest message
          const { data: latestMsg } = await supabase
            .from("messages")
            .select("content, created_at")
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          // Unread count
          const { count: unreadCount } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("group_id", group.id)
            .gt("created_at", lastRead);

          return {
            id: group.id,
            name: group.name || "Untitled Group",
            last_message: latestMsg?.content || "No messages yet",
            last_message_time: latestMsg?.created_at || group.created_at,
            unread_count: unreadCount || 0,
            is_group: true,
            is_announcement: group.is_announcement,
          };
        })
      );

      // Sort by last message time
      const sorted = chatsWithData.sort(
        (a, b) =>
          new Date(b.last_message_time).getTime() -
          new Date(a.last_message_time).getTime()
      );

      setChats(sorted);
    } catch (error) {
      console.error("[Chats] Error fetching chats:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchChats(true);
    setRefreshing(false);
  };

  const navigateToChat = (chatId: string, chatName: string) => {
    router.push(
      `/chat/${chatId}?name=${encodeURIComponent(chatName || "Chat")}`
    );
  };

  const handleLongPress = async (chat: Chat) => {
    setPreviewingChat(chat);
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select(
          `
          id,
          content,
          created_at,
          profiles (full_name)
        `
        )
        .eq("group_id", chat.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!error && data) {
        setPreviewMessages(data.reverse());
      }
    } catch (err) {
      console.error("[Chats] Error fetching preview messages:", err);
    } finally {
      setPreviewLoading(false);
    }
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
          <ActivityIndicator size="large" color={colors.primary} />
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
            refreshing={refreshing}
            onRefresh={onRefresh}
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.chatItem, isDarkMode && styles.darkChatItem]}
                onPress={() => navigateToChat(item.id, item.name)}
                onLongPress={() => handleLongPress(item)}
                delayLongPress={500}
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

      {/* Long Press Preview Modal */}
      <Modal
        visible={!!previewingChat}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewingChat(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPreviewingChat(null)}
        >
          <View
            style={[
              styles.previewContainer,
              isDarkMode && styles.darkPreviewContainer,
            ]}
          >
            <View
              style={[
                styles.previewHeader,
                isDarkMode && styles.darkPreviewHeader,
              ]}
            >
              <View style={styles.previewHeaderTop}>
                <View
                  style={[
                    styles.previewAvatar,
                    previewingChat?.is_announcement &&
                      styles.announcementAvatar,
                  ]}
                >
                  <Ionicons
                    name={previewingChat?.is_group ? "people" : "person"}
                    size={20}
                    color="#fff"
                  />
                </View>
                <View style={styles.previewTitleContainer}>
                  <Text
                    style={[styles.previewTitle, isDarkMode && styles.darkText]}
                  >
                    {previewingChat?.name}
                  </Text>
                  <Text
                    style={[
                      styles.previewSubtitle,
                      isDarkMode && styles.darkPreviewSubtitle,
                    ]}
                  >
                    Recent Activity
                  </Text>
                </View>
              </View>
            </View>

            {previewLoading ? (
              <View
                style={[
                  styles.previewLoadingContainer,
                  isDarkMode && styles.darkPreviewScroll,
                ]}
              >
                <ActivityIndicator
                  size="large"
                  color={isDarkMode ? "#4dabf5" : "#007AFF"}
                />
              </View>
            ) : (
              <ScrollView
                style={[
                  styles.previewScroll,
                  isDarkMode && styles.darkPreviewScroll,
                ]}
                contentContainerStyle={styles.previewScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {previewMessages.length === 0 ? (
                  <View style={styles.noMessagesContainer}>
                    <Ionicons
                      name="chatbubbles-outline"
                      size={48}
                      color={isDarkMode ? "#555" : "#ccc"}
                    />
                    <Text
                      style={[
                        styles.noMessagesText,
                        isDarkMode && styles.darkPreviewSubtitle,
                      ]}
                    >
                      No recent messages
                    </Text>
                  </View>
                ) : (
                  previewMessages.map((msg) => {
                    const isMe = msg.user_id === user?.id;
                    return (
                      <View
                        key={msg.id}
                        style={[
                          styles.previewBubbleWrapper,
                          isMe ? styles.bubbleRight : styles.bubbleLeft,
                        ]}
                      >
                        {!isMe && (
                          <Text
                            style={[
                              styles.bubbleSender,
                              isDarkMode && styles.darkBubbleSender,
                            ]}
                          >
                            {msg.profiles?.full_name?.split(" ")[0] || "User"}
                          </Text>
                        )}
                        <View
                          style={[
                            styles.previewBubble,
                            isMe ? styles.myBubble : styles.theirBubble,
                            isDarkMode && isMe && styles.darkMyBubble,
                            isDarkMode && !isMe && styles.darkTheirBubble,
                          ]}
                        >
                          <Text
                            style={[
                              styles.previewContent,
                              isMe
                                ? styles.myBubbleText
                                : isDarkMode
                                ? styles.darkText
                                : styles.theirBubbleText,
                            ]}
                          >
                            {msg.content}
                          </Text>
                          <Text
                            style={[
                              styles.previewTime,
                              isMe ? styles.myTimeText : styles.theirTimeText,
                            ]}
                          >
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            <View
              style={[
                styles.previewActions,
                isDarkMode && styles.darkPreviewActions,
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.previewButton,
                  styles.previewCloseButton,
                  isDarkMode && styles.darkPreviewCloseButton,
                ]}
                onPress={() => setPreviewingChat(null)}
              >
                <Text
                  style={[
                    styles.previewButtonText,
                    isDarkMode && styles.darkText,
                  ]}
                >
                  Dismiss
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.previewButton, styles.previewOpenButton]}
                onPress={() => {
                  const id = previewingChat?.id;
                  const name = previewingChat?.name;
                  setPreviewingChat(null);
                  if (id) navigateToChat(id, name!);
                }}
              >
                <Text style={[styles.previewButtonText, styles.openButtonText]}>
                  Open Chat
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 24,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  previewContainer: {
    width: "90%",
    maxHeight: "80%",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 0,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.4,
    shadowRadius: 25,
    elevation: 20,
  },
  darkPreviewContainer: {
    backgroundColor: "#1e1e1e",
  },
  previewHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  darkPreviewHeader: {
    backgroundColor: "#1e1e1e",
    borderBottomColor: "#333",
  },
  previewHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  previewAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  previewTitleContainer: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  previewSubtitle: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  darkPreviewSubtitle: {
    color: "#888",
  },
  previewLoadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  previewScroll: {
    flexGrow: 0,
    backgroundColor: "#f8f9fa",
  },
  darkPreviewScroll: {
    backgroundColor: "#161618",
  },
  previewScrollContent: {
    padding: 15,
  },
  previewBubbleWrapper: {
    marginBottom: 10,
    maxWidth: "85%",
  },
  bubbleLeft: {
    alignSelf: "flex-start",
  },
  bubbleRight: {
    alignSelf: "flex-end",
  },
  bubbleSender: {
    fontSize: 10,
    color: "#888",
    marginBottom: 2,
    marginLeft: 12,
  },
  darkBubbleSender: {
    color: "#aaa",
  },
  previewBubble: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 18,
  },
  myBubble: {
    backgroundColor: "#007AFF",
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  darkMyBubble: {
    backgroundColor: "#0056b3",
  },
  darkTheirBubble: {
    backgroundColor: "#2c2c2e",
  },
  previewContent: {
    fontSize: 14,
    lineHeight: 18,
  },
  myBubbleText: {
    color: "#fff",
  },
  theirBubbleText: {
    color: "#333",
  },
  previewTime: {
    fontSize: 9,
    marginTop: 4,
    textAlign: "right",
  },
  myTimeText: {
    color: "rgba(255,255,255,0.7)",
  },
  theirTimeText: {
    color: "#999",
  },
  noMessagesContainer: {
    alignItems: "center",
    padding: 40,
  },
  noMessagesText: {
    marginTop: 10,
    color: "#999",
  },
  previewActions: {
    flexDirection: "row",
    padding: 15,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    gap: 12,
  },
  darkPreviewActions: {
    backgroundColor: "#1e1e1e",
    borderTopColor: "#333",
  },
  previewButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCloseButton: {
    backgroundColor: "#f2f2f7",
  },
  darkPreviewCloseButton: {
    backgroundColor: "#2c2c2e",
  },
  previewOpenButton: {
    backgroundColor: "#007AFF",
  },
  previewButtonText: {
    fontWeight: "600",
    fontSize: 15,
  },
  openButtonText: {
    color: "#fff",
  },
});
