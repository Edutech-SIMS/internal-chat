import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { canSendMessages } from "lib/message-permissions";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import EmojiSelector, { Categories } from "react-native-emoji-selector";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

const { width, height } = Dimensions.get("window");

interface Message {
  id: string;
  content: string;
  created_at: string;
  profiles: {
    full_name: string;
    email: string;
  };
}

interface GroupMember {
  id: string;
  user_id: string;
  joined_at: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

export default function ChatScreen() {
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [infoVisible, setInfoVisible] = useState(false);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [isAnnouncementGroup, setIsAnnouncementGroup] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const { user, profile, schoolId } = useAuth();
  const params = useLocalSearchParams();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textInputRef = useRef<TextInput>(null);

  const chatId = params.id as string;
  const chatName = params.name || (params.email as string);

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (infoVisible) {
      fetchGroupInfo();
      fetchGroupMembers();
    }
  }, [infoVisible]);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  useEffect(() => {
    const initChat = async () => {
      const group = await fetchGroupInfo();
      await checkMessagePermissions(group);
      fetchMessages(true);
      setupRealtimeSubscription();
    };
    initChat();
  }, [chatId]);

  const setupRealtimeSubscription = () => {
    // Subscribe to typing events
    const typingSubscription = supabase
      .channel("typing-events")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "typing_indicators",
          filter: `group_id=eq.${chatId}`, // Optimized: Filter by group_id directly
        },

        (payload) => {
          if (payload.eventType === "INSERT") {
            const newTypingUser = payload.new.user_id;
            if (newTypingUser !== profile?.user_id) {
              setTypingUsers((prev) => new Set(prev).add(newTypingUser));
            }
          } else if (payload.eventType === "DELETE") {
            const stoppedTypingUser = payload.old.user_id;
            setTypingUsers((prev) => {
              const newSet = new Set(prev);
              newSet.delete(stoppedTypingUser);
              return newSet;
            });
          }
        }
      )
      .subscribe();

    return () => {
      typingSubscription.unsubscribe();
    };
  };

  const handleTyping = async (isTyping: boolean) => {
    if (!user) return;

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (isTyping) {
      // Send typing start event
      await supabase.from("typing_indicators").upsert({
        user_id: profile?.user_id, // Use profile.user_id instead of user.id
        group_id: chatId,
        is_typing: true,
        updated_at: new Date().toISOString(),
      });

      // Set timeout to automatically stop typing after 3 seconds
      typingTimeoutRef.current = setTimeout(() => {
        handleTyping(false);
      }, 3000);
    } else {
      // Send typing stop event
      await supabase
        .from("typing_indicators")
        .delete()
        .eq("user_id", profile?.user_id); // Use profile.user_id instead of user.id
    }
  };

  const checkMessagePermissions = async (groupData?: any) => {
    if (!user || !profile?.user_id) return;

    setCheckingPermission(true);
    try {
      // Optimization: Pass group object if available to avoid re-fetching in canSendMessages if we could modify it,
      // but canSendMessages signature is (chatId, userId).
      // We can at least avoid the second fetch for is_announcement below.

      const hasPermission = await canSendMessages(chatId, profile.user_id);
      setCanSend(hasPermission);

      if (groupData) {
        setIsAnnouncementGroup(groupData.is_announcement);
      } else {
        // Fallback if no group data passed (shouldn't happen with new flow)
        const { data: group } = await supabase
          .from("groups")
          .select("is_announcement")
          .eq("id", chatId)
          .single();
        setIsAnnouncementGroup(group?.is_announcement || false);
      }
    } catch (error) {
      console.error("Error checking permissions:", error);
      setCanSend(false);
    } finally {
      setCheckingPermission(false);
    }
  };

  const fetchGroupInfo = async () => {
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, description, created_at, is_announcement")
      .eq("id", chatId)
      .eq("school_id", schoolId)
      .single();

    if (error) {
      console.error("Error fetching group info:", error);
      return null;
    } else {
      setGroupInfo(data);
      setIsAnnouncementGroup(data.is_announcement);
      return data;
    }
  };

  const fetchGroupMembers = async () => {
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select(
          `
        id,
        user_id,
        joined_at,
        profiles (
          full_name,
          email
        )
      `
        )
        .eq("group_id", chatId);

      if (error) throw error;

      const members = (data || []).map((member: any) => ({
        ...member,
        profiles: Array.isArray(member.profiles)
          ? member.profiles[0]
          : member.profiles,
      }));

      setGroupMembers(members);
    } catch (error) {
      console.error("Error fetching group members:", error);
    }
  };

  const fetchMessages = async (isInitial = false) => {
    if (!user) return;

    if (isInitial) {
      setMessages([]);
      setHasMoreMessages(true);
    }

    if (!isInitial && !hasMoreMessages) return;

    if (!isInitial) setIsLoadingMore(true);

    try {
      let query = supabase
        .from("messages")
        .select(
          `
        id,
        content,
        created_at,
        profiles (full_name, email)
      `
        )
        .eq("group_id", chatId)
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false }) // Fetch latest first
        .limit(50);

      // If loading more, fetch messages older than the oldest one we have
      if (!isInitial && messages.length > 0) {
        const oldestMessage = messages[0];
        query = query.lt("created_at", oldestMessage.created_at);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching messages:", error);
      } else {
        const newMessages = (data || [])
          .map((msg: any) => ({
            ...msg,
            profiles: Array.isArray(msg.profiles)
              ? msg.profiles[0]
              : msg.profiles,
          }))
          .reverse(); // Reverse to chronological order

        if (data.length < 50) {
          setHasMoreMessages(false);
        }

        if (isInitial) {
          setMessages(newMessages);
          // Auto scroll to bottom on initial load
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }, 100);
        } else {
          setMessages((prev) => [...newMessages, ...prev]);
        }
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return;

    if (!canSend) {
      Alert.alert(
        "Permission Denied",
        "You do not have permission to send messages in this announcement group."
      );
      return;
    }

    setSending(true);
    handleTyping(false);

    // Insert the message
    const { data: newMessageData, error } = await supabase
      .from("messages")
      .insert([
        {
          content: newMessage,
          user_id: profile?.user_id, // Use profile.user_id instead of user.id to match foreign key constraint
          group_id: chatId,
          school_id: schoolId,
        },
      ])
      .select("*, profiles(full_name, email)")
      .single();

    if (error) {
      Alert.alert("Error", error.message);
      console.log("Error inserting message:", error);
      setSending(false);
      return;
    }

    // Optimistically update messages
    const formattedMessage = {
      ...newMessageData,
      profiles: Array.isArray(newMessageData.profiles)
        ? newMessageData.profiles[0]
        : newMessageData.profiles,
    };

    setMessages((prev) => [...prev, formattedMessage]);
    setNewMessage("");
    setSending(false);

    try {
      // Trigger push notifications via Edge Function
      const { data, error: pushError } = await supabase.functions.invoke(
        "send-push-message",
        {
          body: {
            message: newMessage,
            group_id: chatId,
            school_id: schoolId,
            sender_id: profile!.user_id, // Use profile.user_id instead of user.id
          },
        }
      );

      if (pushError) {
        console.error("Push notification error:", pushError);
      } else {
        console.log("Push notification sent:", data);
      }
    } catch (err) {
      console.error("Push notification failed:", err);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage((prev) => prev + emoji);
    textInputRef.current?.focus();
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return "Just now";
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMyMessage =
      item.profiles?.full_name === user?.user_metadata?.full_name;

    const alignRight = !isAnnouncementGroup && isMyMessage;

    // Only show avatar on last bubble in a block
    const nextMessage = messages[index + 1];
    const isLastFromUser =
      !nextMessage ||
      nextMessage.profiles?.full_name !== item.profiles?.full_name;

    return (
      <View
        style={[
          styles.messageRow,
          alignRight ? styles.rowRight : styles.rowLeft,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            alignRight ? styles.myMessageBubble : styles.otherMessageBubble,
          ]}
        >
          {/* Sender name (only once, and not for my messages) */}
          {!alignRight && (
            <Text style={styles.senderName}>
              {item.profiles?.full_name || item.profiles?.email || "Unknown"}
            </Text>
          )}

          <Text
            style={[
              styles.messageText,
              alignRight ? styles.myMessageText : styles.otherMessageText,
            ]}
          >
            {item.content}
          </Text>

          <Text
            style={[
              styles.timestamp,
              alignRight ? styles.myTimestamp : styles.otherTimestamp,
            ]}
          >
            {formatTime(item.created_at)}
          </Text>

          {/* Avatar overlay (only last bubble in block) */}
          {isLastFromUser && (
            <View
              style={[
                styles.avatarOverlay,
                alignRight ? { right: -38 } : { left: -38 },
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {getInitials(
                    alignRight
                      ? user?.user_metadata?.full_name || "Me"
                      : item.profiles?.full_name || "U"
                  )}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (checkingPermission) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <StatusBar
          barStyle={isDarkMode ? "light-content" : "dark-content"}
          backgroundColor={colors.background}
        />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>
              Loading chat...
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar
        barStyle={isDarkMode ? "light-content" : "dark-content"}
        backgroundColor={colors.card}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        {/* Enhanced Header */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text
              style={[styles.headerTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {chatName || "Chat"}
            </Text>
            {isAnnouncementGroup && (
              <View style={styles.announcementBadge}>
                <Ionicons name="megaphone" size={12} color="#FF6B35" />
                <Text style={styles.announcementText}>Announcement</Text>
              </View>
            )}
            {typingUsers.size > 0 && (
              <Text style={[styles.typingText, { color: colors.text }]}>
                {Array.from(typingUsers).length === 1
                  ? "1 person is typing..."
                  : `${Array.from(typingUsers).length} people are typing...`}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.infoButton}
            onPress={() => setInfoVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="information-circle"
              size={24}
              color={colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Messages List */}
        <Animated.View
          style={[
            styles.messageContainer,
            {
              opacity: fadeAnim,
              backgroundColor: colors.background,
            },
          ]}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyIconContainer,
                  { backgroundColor: colors.card },
                ]}
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={80}
                  color={isDarkMode ? "#444444" : "#E5E5E7"}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No messages yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.text }]}>
                {canSend
                  ? "Start the conversation with a friendly message!"
                  : isAnnouncementGroup
                  ? "This is an announcement group. Only authorized users can send messages."
                  : "Be the first to start the conversation!"}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: true })
              }
            />
          )}
        </Animated.View>

        {/* Enhanced Message Input */}
        {canSend && (
          <Animated.View
            style={[
              styles.inputContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
                backgroundColor: colors.card,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: colors.inputBackground },
              ]}
            >
              <TouchableOpacity
                style={styles.emojiButton}
                onPress={() => {
                  if (showEmojiPicker) {
                    setShowEmojiPicker(false);
                    textInputRef.current?.focus();
                  } else {
                    Keyboard.dismiss();
                    setShowEmojiPicker(true);
                  }
                }}
              >
                <Ionicons
                  name={showEmojiPicker ? "keypad-outline" : "happy-outline"}
                  size={24}
                  color={colors.text}
                />
              </TouchableOpacity>

              <TextInput
                ref={textInputRef}
                value={newMessage}
                onChangeText={(text) => {
                  setNewMessage(text);
                  handleTyping(text.length > 0);
                }}
                placeholder="Type a message..."
                placeholderTextColor={colors.placeholderText}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                  !newMessage && { textAlignVertical: "center" },
                ]}
                multiline
                maxLength={500}
              />

              <TouchableOpacity
                onPress={sendMessage}
                style={[
                  styles.sendButton,
                  newMessage.trim() && !sending
                    ? styles.sendButtonActive
                    : styles.sendButtonInactive,
                  {
                    backgroundColor:
                      newMessage.trim() && !sending
                        ? colors.primary
                        : "transparent",
                  },
                ]}
                disabled={!newMessage.trim() || sending}
                activeOpacity={0.8}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons
                    name="send"
                    size={20}
                    color={
                      newMessage.trim() && !sending
                        ? colors.text
                        : colors.placeholderText
                    }
                  />
                )}
              </TouchableOpacity>
            </View>

            {/* Emoji Picker */}
            {showEmojiPicker && (
              <View
                style={[
                  styles.emojiPickerContainer,
                  { borderTopColor: colors.border },
                ]}
              >
                <EmojiSelector
                  onEmojiSelected={handleEmojiSelect}
                  category={Categories.all}
                  columns={8}
                  showSearchBar={false}
                  showHistory={true}
                  showTabs={true}
                  showSectionTitles={true}
                />
              </View>
            )}
          </Animated.View>
        )}

        {/* Permission Notice */}
        {!canSend && isAnnouncementGroup && (
          <Animated.View
            style={[
              styles.permissionNotice,
              {
                opacity: fadeAnim,
                backgroundColor: isDarkMode ? "#3a1a12" : "#FFF4F2",
                borderTopColor: colors.border,
              },
            ]}
          >
            <View
              style={[styles.permissionIcon, { backgroundColor: colors.card }]}
            >
              <Ionicons name="megaphone" size={18} color="#FF6B35" />
            </View>
            <Text style={[styles.permissionText, { color: "#FF6B35" }]}>
              This is an announcement group. Only authorized users can send
              messages.
            </Text>
          </Animated.View>
        )}

        {/* Enhanced Group Info Modal */}
        <Modal
          visible={infoVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setInfoVisible(false)}
        >
          <View
            style={[styles.modalContainer, { backgroundColor: colors.card }]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Group Info
              </Text>
              <TouchableOpacity onPress={() => setInfoVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {groupInfo ? (
              <ScrollView
                style={styles.modalContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.groupHeaderSection}>
                  <View
                    style={[
                      styles.groupIconLarge,
                      { backgroundColor: colors.primary + "20" },
                    ]}
                  >
                    <Ionicons
                      name={groupInfo.is_announcement ? "megaphone" : "people"}
                      size={40}
                      color={colors.primary}
                    />
                  </View>
                  <Text style={[styles.groupNameLarge, { color: colors.text }]}>
                    {groupInfo.name}
                  </Text>
                  {groupInfo.description && (
                    <Text
                      style={[
                        styles.groupDescription,
                        { color: colors.placeholderText },
                      ]}
                    >
                      {groupInfo.description}
                    </Text>
                  )}
                  <View style={styles.groupMetaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons
                        name="calendar-outline"
                        size={14}
                        color={colors.placeholderText}
                      />
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        Created{" "}
                        {new Date(groupInfo.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons
                        name={
                          groupInfo.is_announcement
                            ? "megaphone-outline"
                            : "chatbubbles-outline"
                        }
                        size={14}
                        color={colors.placeholderText}
                      />
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.placeholderText },
                        ]}
                      >
                        {groupInfo.is_announcement
                          ? "Announcement"
                          : "Public Chat"}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.membersSection}>
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: colors.placeholderText },
                    ]}
                  >
                    Members ({groupMembers.length})
                  </Text>
                  {groupMembers.map((member) => (
                    <View
                      key={member.id}
                      style={[
                        styles.memberItem,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {getInitials(
                            member.profiles?.full_name ||
                              member.profiles?.email ||
                              "?"
                          )}
                        </Text>
                      </View>
                      <View style={styles.memberInfo}>
                        <Text
                          style={[styles.memberName, { color: colors.text }]}
                        >
                          {member.profiles?.full_name ||
                            member.profiles?.email ||
                            "Unknown User"}
                        </Text>
                        <Text
                          style={[
                            styles.memberEmail,
                            { color: colors.placeholderText },
                          ]}
                        >
                          {member.profiles?.email && member.profiles?.full_name
                            ? member.profiles.email
                            : ""}
                        </Text>
                      </View>
                      {member.user_id === groupInfo.created_by && (
                        <View style={styles.adminBadge}>
                          <Text style={styles.adminBadgeText}>Admin</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.modalLoadingText, { color: colors.text }]}>
                  Loading group info...
                </Text>
              </View>
            )}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContent: {
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: "500",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
    marginLeft: 12,
  },
  announcementBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF4F2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 2,
  },
  announcementText: {
    fontSize: 11,
    color: "#FF6B35",
    fontWeight: "500",
    marginLeft: 4,
  },
  typingText: {
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 2,
  },
  infoButton: {
    padding: 8,
    marginRight: -8,
  },
  messageContainer: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  messagesList: {
    padding: 16,
    paddingBottom: 20,
  },
  messageWrapper: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-end",
  },
  myMessageWrapper: {
    justifyContent: "flex-end",
  },
  otherMessageWrapper: {
    justifyContent: "flex-start",
  },

  avatarSpacer: {
    width: 40,
  },

  messageBubble: {
    maxWidth: width * 0.75,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  myMessageBubble: {
    backgroundColor: "#007AFF",
    borderBottomRightRadius: 4,
  },
  otherMessageBubble: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  senderName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8E8E93",
    marginBottom: 4,
  },
  messageText: {
    fontSize: 16,
  },
  myMessageText: {
    color: "#FFFFFF",
  },
  otherMessageText: {
    color: "#1C1C1E",
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  myTimestamp: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  otherTimestamp: {
    color: "#8E8E93",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderTopWidth: 1,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },

  emojiButton: {
    padding: 8,
    marginRight: 4,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
  },

  sendButton: {
    borderRadius: 20,
    padding: 10,
  },
  sendButtonActive: {},
  sendButtonInactive: {
    backgroundColor: "transparent",
  },
  emojiPickerContainer: {
    height: 250,
    marginTop: 8,
    borderTopWidth: 1,
  },
  permissionNotice: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 0.5,
  },
  permissionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  modalContainer: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  modalTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginLeft: 8,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
  },
  infoCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  infoItemTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoItemValue: {
    fontSize: 16,
    fontWeight: "500",
  },
  typeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  readOnlyNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF4F2",
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  readOnlyText: {
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
    color: "#FF6B35",
  },
  modalLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  modalLoadingText: {
    fontSize: 16,
    marginLeft: 12,
  },
  modalCloseButtonLarge: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  modalCloseButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },

  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
    position: "relative",
    paddingHorizontal: 48,
  },
  rowLeft: {
    justifyContent: "flex-start",
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  avatarOverlay: {
    position: "absolute",
    bottom: 0,
  },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  groupHeaderSection: {
    alignItems: "center",
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E7",
  },
  groupIconLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  groupNameLarge: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  groupDescription: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 32,
  },
  groupMetaRow: {
    flexDirection: "row",
    gap: 16,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 14,
  },
  membersSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 12,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E5E5E7",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberEmail: {
    fontSize: 14,
  },
  adminBadge: {
    backgroundColor: "#E5E5E7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666",
  },
});
