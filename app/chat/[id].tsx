import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
  StatusBar,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../contexts/AuthContext";
import { canSendMessages } from "../../lib/message-permissions";
import { supabase } from "../../lib/supabase";

const { width, height } = Dimensions.get("window");

interface Message {
  id: string;
  content: string;
  created_at: string;
  profiles: {
    full_name: string;
  };
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [infoVisible, setInfoVisible] = useState(false);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [canSend, setCanSend] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [isAnnouncementGroup, setIsAnnouncementGroup] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const { user } = useAuth();
  const params = useLocalSearchParams();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const insets = useSafeAreaInsets();

  const chatId = params.id as string;
  const chatName = params.name as string;

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
    }
  }, [infoVisible]);

  useEffect(() => {
    fetchMessages();
    setupRealtime();
    checkMessagePermissions();
  }, [chatId]);

  const checkMessagePermissions = async () => {
    if (!user) return;

    setCheckingPermission(true);
    try {
      const hasPermission = await canSendMessages(chatId, user.id);
      setCanSend(hasPermission);

      const { data: group } = await supabase
        .from("groups")
        .select("is_announcement")
        .eq("id", chatId)
        .single();

      setIsAnnouncementGroup(group?.is_announcement || false);
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
      .single();

    if (error) {
      console.error("Error fetching group info:", error);
    } else {
      setGroupInfo(data);
      setIsAnnouncementGroup(data.is_announcement);
    }
  };

  const fetchMessages = async () => {
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
      .eq("group_id", chatId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching messages:", error);
    } else {
      setMessages(
        (data || []).map((msg: any) => ({
          ...msg,
          profiles: Array.isArray(msg.profiles)
            ? msg.profiles[0]
            : msg.profiles,
        }))
      );
      // Auto scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const setupRealtime = () => {
    const channel = supabase
      .channel("messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${chatId}`,
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    if (!canSend) {
      Alert.alert(
        "Permission Denied",
        "You do not have permission to send messages in this announcement group."
      );
      return;
    }

    const { error } = await supabase
      .from("messages")
      .insert([{ content: newMessage, user_id: user?.id, group_id: chatId }]);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setNewMessage("");
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
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
    const showAvatar =
      !isMyMessage &&
      (index === 0 ||
        messages[index - 1].profiles?.full_name !== item.profiles?.full_name);

    return (
      <Animated.View
        style={[
          styles.messageWrapper,
          isMyMessage ? styles.myMessageWrapper : styles.otherMessageWrapper,
        ]}
      >
        {!isMyMessage && showAvatar && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {getInitials(item.profiles?.full_name || "U")}
            </Text>
          </View>
        )}
        {!isMyMessage && !showAvatar && <View style={styles.avatarSpacer} />}

        <View
          style={[
            styles.messageBubble,
            isMyMessage ? styles.myMessageBubble : styles.otherMessageBubble,
          ]}
        >
          {!isMyMessage && showAvatar && (
            <Text style={styles.senderName}>
              {item.profiles?.full_name || "Unknown User"}
            </Text>
          )}
          <Text
            style={[
              styles.messageText,
              isMyMessage ? styles.myMessageText : styles.otherMessageText,
            ]}
          >
            {item.content || ""}
          </Text>
          <Text
            style={[
              styles.timestamp,
              isMyMessage ? styles.myTimestamp : styles.otherTimestamp,
            ]}
          >
            {formatTime(item.created_at)}
          </Text>
        </View>
      </Animated.View>
    );
  };

  if (checkingPermission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading chat...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Enhanced Header */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {chatName || "Chat"}
            </Text>
            {isAnnouncementGroup && (
              <View style={styles.announcementBadge}>
                <Ionicons name="megaphone" size={12} color="#FF6B35" />
                <Text style={styles.announcementText}>Announcement</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.infoButton}
            onPress={() => setInfoVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="information-circle" size={24} color="#007AFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Messages List */}
        <Animated.View
          style={[
            styles.messagesContainer,
            {
              opacity: fadeAnim,
            },
          ]}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={80}
                  color="#E5E5E7"
                />
              </View>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>
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
              },
            ]}
          >
            <View style={styles.inputWrapper}>
              <TextInput
                value={newMessage}
                onChangeText={(text) => {
                  setNewMessage(text);
                  setIsTyping(text.length > 0);
                }}
                placeholder="Type a message..."
                placeholderTextColor="#8E8E93"
                style={styles.textInput}
                multiline
                maxLength={500}
                textAlignVertical="center"
              />
              <TouchableOpacity
                onPress={sendMessage}
                style={[
                  styles.sendButton,
                  newMessage.trim()
                    ? styles.sendButtonActive
                    : styles.sendButtonInactive,
                ]}
                disabled={!newMessage.trim()}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={newMessage.trim() ? "#FFFFFF" : "#8E8E93"}
                />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Permission Notice */}
        {!canSend && isAnnouncementGroup && (
          <Animated.View
            style={[
              styles.permissionNotice,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            <View style={styles.permissionIcon}>
              <Ionicons name="megaphone" size={18} color="#FF6B35" />
            </View>
            <Text style={styles.permissionText}>
              This is an announcement group. Only authorized users can send
              messages.
            </Text>
          </Animated.View>
        )}

        {/* Enhanced Group Info Modal */}
        <Modal
          visible={infoVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setInfoVisible(false)}
        >
          <SafeAreaView style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHandle} />

              <View style={styles.modalHeader}>
                <View style={styles.modalTitleContainer}>
                  <Ionicons
                    name="information-circle"
                    size={24}
                    color="#007AFF"
                  />
                  <Text style={styles.modalTitle}>Group Info</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setInfoVisible(false)}
                  style={styles.modalCloseButton}
                >
                  <Ionicons name="close" size={24} color="#8E8E93" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.modalContent}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                {groupInfo ? (
                  <>
                    <View style={styles.infoCard}>
                      <Text style={styles.infoItemTitle}>Group Name</Text>
                      <Text style={styles.infoItemValue}>{groupInfo.name}</Text>
                    </View>

                    {groupInfo.description && (
                      <View style={styles.infoCard}>
                        <Text style={styles.infoItemTitle}>Description</Text>
                        <Text style={styles.infoItemValue}>
                          {groupInfo.description}
                        </Text>
                      </View>
                    )}

                    <View style={styles.infoCard}>
                      <Text style={styles.infoItemTitle}>Type</Text>
                      <View style={styles.typeContainer}>
                        <Ionicons
                          name={
                            groupInfo.is_announcement
                              ? "megaphone"
                              : "chatbubbles"
                          }
                          size={16}
                          color={
                            groupInfo.is_announcement ? "#FF6B35" : "#007AFF"
                          }
                        />
                        <Text style={styles.infoItemValue}>
                          {groupInfo.is_announcement
                            ? "Announcements"
                            : "Public chat"}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.infoCard}>
                      <Text style={styles.infoItemTitle}>Created</Text>
                      <Text style={styles.infoItemValue}>
                        {new Date(groupInfo.created_at).toLocaleDateString()}
                      </Text>
                    </View>

                    {groupInfo.is_announcement && !canSend && (
                      <View style={styles.readOnlyNotice}>
                        <Ionicons
                          name="lock-closed"
                          size={16}
                          color="#FF6B35"
                        />
                        <Text style={styles.readOnlyText}>
                          You have read-only access to this group
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={styles.modalLoading}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.modalLoadingText}>
                      Loading group info...
                    </Text>
                  </View>
                )}
              </ScrollView>

              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => setInfoVisible(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
  },
  loadingContent: {
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#8E8E93",
    fontWeight: "500",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E5E7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
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
    fontSize: 17,
    fontWeight: "600",
    color: "#000",
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
  infoButton: {
    padding: 8,
    marginRight: -8,
  },
  messagesContainer: {
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
    backgroundColor: "#FFFFFF",
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
    color: "#1C1C1E",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#8E8E93",
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
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  avatarSpacer: {
    width: 40,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
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
    lineHeight: 20,
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
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E5E7",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: "#1C1C1E",
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonActive: {
    backgroundColor: "#007AFF",
  },
  sendButtonInactive: {
    backgroundColor: "transparent",
  },
  permissionNotice: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#FFF4F2",
    borderTopWidth: 0.5,
    borderTopColor: "#E5E5E7",
  },
  permissionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
    color: "#FF6B35",
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 20 : 10,
    maxHeight: height * 0.85,
    minHeight: height * 0.4,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#E5E5E7",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1C1C1E",
    marginLeft: 8,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
  },
  infoCard: {
    backgroundColor: "#F2F2F7",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  infoItemTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoItemValue: {
    fontSize: 16,
    color: "#1C1C1E",
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
    color: "#FF6B35",
    fontWeight: "500",
    marginLeft: 8,
  },
  modalLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  modalLoadingText: {
    fontSize: 16,
    color: "#8E8E93",
    marginLeft: 12,
  },
  modalCloseButtonLarge: {
    backgroundColor: "#007AFF",
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
});
