import { Ionicons } from "@expo/vector-icons";
import { decode } from "base64-arraybuffer";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { canSendMessages } from "lib/message-permissions";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { getThemeColors } from "../../themes";

const { width } = Dimensions.get("window");

// --- Interfaces ---

interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  attachment_url?: string;
  attachment_type?: string;
  attachment_name?: string;
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

interface SelectedFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

// --- Helper Functions ---

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

// --- Sub-components ---

const MessageItem = React.memo(
  ({
    item,
    user,
    colors,
    isAnnouncementGroup,
    showAvatar,
    onDocPress,
  }: {
    item: Message;
    user: any;
    colors: any;
    isAnnouncementGroup: boolean;
    showAvatar: boolean;
    onDocPress: (url: string, name: string) => void;
  }) => {
    const isMyMessage = item.user_id === user?.id;
    const alignRight = !isAnnouncementGroup && isMyMessage;
    const isImage = item.attachment_type?.startsWith("image/");

    // Read Receipt Logic
    const renderReadReceipt = () => {
      if (!isMyMessage) return null;

      // If announcement group, maybe hide or show differently? For now show same.

      // Determine icon based on read status
      // We need to know:
      // 1. Sent (default)
      // 2. Read by some
      // 3. Read by all

      // Passed via props now
      const { readCount, totalMembers, isReadByAll } = (item as any)
        .readInfo || { readCount: 0, totalMembers: 0, isReadByAll: false };

      if (isReadByAll) {
        return (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginLeft: 4,
            }}
          >
            <Ionicons name="checkmark-done" size={16} color="#4dabf5" />
          </View>
        );
      }

      return (
        <View
          style={{ flexDirection: "row", alignItems: "center", marginLeft: 4 }}
        >
          <Ionicons name="checkmark" size={16} color="rgba(255,255,255,0.7)" />
        </View>
      );
    };

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
            alignRight
              ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
              : {
                  backgroundColor: colors.card,
                  borderBottomLeftRadius: 4,
                  shadowColor: "#000",
                  shadowOpacity: 0.05,
                  shadowRadius: 2,
                  elevation: 1,
                },
          ]}
        >
          {!alignRight && (
            <Text
              style={[styles.senderName, { color: colors.placeholderText }]}
              numberOfLines={1}
            >
              {item.profiles?.full_name || item.profiles?.email || "Unknown"}
            </Text>
          )}

          {item.attachment_url && (
            <View style={styles.attachmentContainer}>
              {isImage ? (
                <TouchableOpacity
                  onPress={() => {
                    (item as any).onImagePress?.(item.attachment_url!);
                  }}
                >
                  <Image
                    source={{ uri: item.attachment_url }}
                    style={[
                      styles.attachedImage,
                      { borderColor: colors.border },
                    ]}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.fileAttachment,
                    { backgroundColor: "rgba(0,0,0,0.1)" },
                  ]}
                  onPress={() =>
                    onDocPress(
                      item.attachment_url!,
                      item.attachment_name || "Attachment"
                    )
                  }
                >
                  <View style={styles.fileIconContainer}>
                    <Ionicons
                      name="document-text"
                      size={24}
                      color={alignRight ? "white" : colors.primary}
                    />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text
                      style={[
                        styles.fileName,
                        { color: alignRight ? "white" : colors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {item.attachment_name || "Attachment"}
                    </Text>
                    <Text
                      style={[
                        styles.fileType,
                        {
                          color: alignRight
                            ? "rgba(255,255,255,0.8)"
                            : colors.placeholderText,
                        },
                      ]}
                    >
                      Click to view
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text
            style={[
              styles.messageText,
              alignRight ? { color: "#FFFFFF" } : { color: colors.text },
            ]}
          >
            {item.content}
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 4,
              marginTop: 4,
            }}
          >
            <Text
              style={[
                styles.timestamp,
                alignRight
                  ? { color: "rgba(255, 255, 255, 0.7)" }
                  : { color: colors.placeholderText },
                { marginTop: 0 },
              ]}
            >
              {formatTime(item.created_at)}
            </Text>
            {renderReadReceipt()}
          </View>

          {showAvatar && (
            <View
              style={[
                styles.avatarOverlay,
                alignRight ? { right: -38 } : { left: -38 },
              ]}
            >
              <View
                style={[styles.avatar, { backgroundColor: colors.primary }]}
              >
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
  }
);

// --- Main Component ---

export default function ChatScreen() {
  const { isDarkMode } = useTheme();
  const colors = getThemeColors(isDarkMode);

  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [isAnnouncementGroup, setIsAnnouncementGroup] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [readStatuses, setReadStatuses] = useState<{
    [userId: string]: string;
  }>({});
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [docViewerVisible, setDocViewerVisible] = useState(false);
  const [docViewerUrl, setDocViewerUrl] = useState<string | null>(null);
  const [docViewerName, setDocViewerName] = useState<string | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  // Hooks
  const { user, profile, schoolId } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const router = useRouter();

  // Refs
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textInputRef = useRef<TextInput>(null);

  const chatId = params.id as string;
  const chatName = params.name || (params.email as string);

  // Computed
  const isGroupAdmin = useMemo(() => {
    return (
      groupInfo?.created_by === profile?.user_id ||
      (profile?.roles &&
        profile.roles.some(
          (role: any) => role.role === "admin" || role.role === "superadmin"
        ))
    );
  }, [groupInfo, profile]);

  // Effects
  useEffect(() => {
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

  useEffect(() => {
    const initChat = async () => {
      setIsInitialLoading(true);
      try {
        const group = await fetchGroupInfo();
        const permissionPromise = checkMessagePermissions(group);
        const messagesPromise = fetchMessages(true);
        const membersPromise = fetchGroupMembers();

        await Promise.all([permissionPromise, messagesPromise, membersPromise]);

        markAsRead();
        fetchReadStatuses();
      } finally {
        setIsInitialLoading(false);
      }
    };
    initChat();
  }, [chatId]);

  // Handle real-time subscriptions separately for clean lifecycle
  useEffect(() => {
    if (!chatId || !profile?.user_id) return;

    const channel = setupRealtimeSubscription();

    return () => {
      console.log(`Cleaning up real-time subscription for chat: ${chatId}`);
      supabase.removeChannel(channel);
    };
  }, [chatId, profile?.user_id]);

  // Mark as read when messages update
  useEffect(() => {
    if (messages.length > 0) {
      markAsRead();
    }
  }, [messages.length]);

  // Logic
  const setupRealtimeSubscription = () => {
    console.log(`[Realtime] Initializing channel for chatId: ${chatId}`);

    // Create a single unique channel for this chat room
    const channel = supabase.channel(`chat:${chatId}`);

    channel
      // 1. Typing indicators
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "typing_indicators",
          filter: `group_id=eq.${chatId}`,
        },
        (payload: any) => {
          const userId = payload.new?.user_id || payload.old?.user_id;
          console.log("[Realtime] Typing Event:", payload.eventType, userId);

          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "UPDATE"
          ) {
            const newTypingUser = payload.new.user_id;
            // Only care about other users
            if (newTypingUser !== profile?.user_id) {
              if (payload.new.is_typing) {
                setTypingUsers((prev) => new Set(prev).add(newTypingUser));
              } else {
                setTypingUsers((prev) => {
                  const newSet = new Set(prev);
                  newSet.delete(newTypingUser);
                  return newSet;
                });
              }
            }
          } else if (payload.eventType === "DELETE") {
            const stoppedTypingUser = payload.old?.user_id;
            if (stoppedTypingUser) {
              setTypingUsers((prev) => {
                const newSet = new Set(prev);
                newSet.delete(stoppedTypingUser);
                return newSet;
              });
            }
          }
        }
      )
      // 2. Read receipts (group_reads)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_reads",
          filter: `group_id=eq.${chatId}`,
        },
        (payload: any) => {
          console.log("[Realtime] Read Receipt Event:", payload.eventType);
          // Re-fetch all read statuses to keep UI in sync
          fetchReadStatuses();
        }
      )
      // 3. New messages
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${chatId}`,
        },
        async (payload: any) => {
          console.log("[Realtime] New Message INSERT:", payload.new.id);

          // Avoid duplicate messages (e.g. if we sent it from this device)
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) {
              console.log(
                "[Realtime] Duplicate message, skipping:",
                payload.new.id
              );
              return prev;
            }

            // Construct a safe temporary message
            // Use payload content if available, otherwise "..."
            const tempMessage: Message = {
              id: payload.new.id,
              user_id: payload.new.user_id,
              content: payload.new.content || "...",
              created_at: payload.new.created_at || new Date().toISOString(),
              attachment_url: payload.new.attachment_url,
              attachment_type: payload.new.attachment_type,
              attachment_name: payload.new.attachment_name,
              profiles: { full_name: "...", email: "" },
            };

            // Re-fetch the full message details (with profiles join)
            fetchSingleMessage(payload.new.id);

            return [...prev, tempMessage];
          });

          // Mark as read immediately when a new message arrives while we're in the chat
          markAsRead();
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] Channel Status [${chatId}]:`, status);
        if (err) {
          console.error(`[Realtime] Subscription Error [${chatId}]:`, err);
        }
        if (status === "CHANNEL_ERROR") {
          console.warn("[Realtime] Channel error. Check RLS and Replication.");
        }
      });

    return channel;
  };

  const fetchSingleMessage = async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select(
          `id, user_id, content, created_at, attachment_url, attachment_type, attachment_name, profiles (full_name, email)`
        )
        .eq("id", messageId)
        .single();

      if (!error && data) {
        const formattedMessage = {
          ...data,
          profiles: Array.isArray(data.profiles)
            ? data.profiles[0]
            : data.profiles,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? formattedMessage : m))
        );
      }
    } catch (err) {
      console.error("Error fetching single message details:", err);
    }
  };

  const handleTyping = async (isTyping: boolean) => {
    if (!user) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    if (isTyping) {
      const { error } = await supabase.from("typing_indicators").upsert(
        {
          user_id: profile?.user_id,
          group_id: chatId,
          is_typing: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,group_id" }
      );

      if (error) console.error("Error setting typing indicator:", error);

      typingTimeoutRef.current = setTimeout(() => {
        handleTyping(false);
      }, 3000);
    } else {
      const { error } = await supabase
        .from("typing_indicators")
        .delete()
        .eq("user_id", profile?.user_id)
        .eq("group_id", chatId);

      if (error) console.error("Error clearing typing indicator:", error);
    }
  };

  const markAsRead = async () => {
    if (!profile?.user_id) return;
    try {
      await supabase.from("group_reads").upsert(
        {
          group_id: chatId,
          user_id: profile.user_id,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: "user_id,group_id" }
      );
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  const fetchReadStatuses = async () => {
    try {
      const { data, error } = await supabase
        .from("group_reads")
        .select("user_id, last_read_at")
        .eq("group_id", chatId);

      if (error) throw error;

      const statusMap: { [userId: string]: string } = {};
      data?.forEach((item) => {
        statusMap[item.user_id] = item.last_read_at;
      });
      setReadStatuses(statusMap);
    } catch (error) {
      console.error("Error fetching read statuses:", error);
    }
  };

  const checkMessagePermissions = async (groupData?: any) => {
    if (!user || !profile?.user_id) return;

    try {
      const hasPermission = await canSendMessages(chatId, profile.user_id);
      setCanSend(hasPermission);

      if (groupData) {
        setIsAnnouncementGroup(groupData.is_announcement);
      } else {
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
    }
  };

  const fetchGroupInfo = async () => {
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, description, created_at, is_announcement, created_by")
      .eq("id", chatId)
      .eq("school_id", schoolId)
      .single();

    if (error) {
      console.error("Error fetching group info:", error);
      return null;
    }
    setGroupInfo(data);
    setIsAnnouncementGroup(data.is_announcement);
    return data;
  };

  const fetchGroupMembers = async () => {
    try {
      const { data, error } = await supabase
        .from("group_members")
        .select(`id, user_id, joined_at, profiles (full_name, email)`)
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
          `id, user_id, content, created_at, attachment_url, attachment_type, attachment_name, profiles (full_name, email)`
        )
        .eq("group_id", chatId)
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!isInitial && messages.length > 0) {
        query = query.lt("created_at", messages[0].created_at);
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
          .reverse();

        if (data.length < 50) setHasMoreMessages(false);

        if (isInitial) {
          setMessages(newMessages);
          setTimeout(
            () => flatListRef.current?.scrollToEnd({ animated: false }),
            100
          );
        } else {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const filteredNew = newMessages.filter(
              (m) => !existingIds.has(m.id)
            );
            return [...filteredNew, ...prev];
          });
        }
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    } catch (error) {
      console.error("Error picking document:", error);
      Alert.alert("Error", "Failed to pick document");
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !profile?.user_id) return null;

    try {
      setIsUploading(true);
      const ext = selectedFile.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .substring(7)}.${ext}`;
      const filePath = `${chatId}/${fileName}`;

      const base64 = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: "base64",
      });

      const { error: uploadError } = await supabase.storage
        .from("chat-attachments")
        .upload(filePath, decode(base64), {
          contentType: selectedFile.mimeType || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("chat-attachments")
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error("Error uploading file:", error);
      Alert.alert("Error", "Failed to upload file");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !selectedFile) || sending || isUploading) return;
    if (!canSend) {
      Alert.alert(
        "Permission Denied",
        "You do not have permission to send messages in this announcement group."
      );
      return;
    }

    setSending(true);
    handleTyping(false);

    let attachmentUrl = null;
    if (selectedFile) {
      attachmentUrl = await uploadFile();
      if (!attachmentUrl) {
        setSending(false);
        return;
      }
    }

    const { data: newMessageData, error } = await supabase
      .from("messages")
      .insert([
        {
          content: newMessage || (selectedFile ? "Sent an attachment" : ""),
          user_id: profile?.user_id,
          group_id: chatId,
          school_id: schoolId,
          attachment_url: attachmentUrl,
          attachment_type: selectedFile?.mimeType || "application/octet-stream",
          attachment_name: selectedFile?.name,
        },
      ])
      .select("*, profiles(full_name, email)")
      .single();

    if (error) {
      Alert.alert("Error", error.message);
      setSending(false);
      return;
    }

    const formattedMessage = {
      ...newMessageData,
      profiles: Array.isArray(newMessageData.profiles)
        ? newMessageData.profiles[0]
        : newMessageData.profiles,
    };

    setMessages((prev) => {
      if (prev.some((m) => m.id === formattedMessage.id)) return prev;
      return [...prev, formattedMessage];
    });
    setNewMessage("");
    setSelectedFile(null);
    setSending(false);

    // Trigger push notification (fire and forget)
    supabase.functions
      .invoke("send-push-message", {
        body: {
          message: newMessage || "Sent an attachment",
          group_id: chatId,
          school_id: schoolId,
          sender_id: profile!.user_id,
        },
      })
      .then(({ error }) => {
        if (error) console.error("Push notification error:", error);
      });
  };

  // Rendering
  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const nextMessage = messages[index + 1];
      const isLastFromUser =
        !nextMessage ||
        nextMessage.profiles?.full_name !== item.profiles?.full_name;

      // Calculate read status
      const msgDate = new Date(item.created_at);
      let readCount = 0;
      const otherMembersCount = Math.max(0, groupMembers.length - 1); // Exclude self

      if (profile?.user_id) {
        readCount = Object.entries(readStatuses).filter(
          ([uid, time]: [string, string]) => {
            return uid !== profile.user_id && new Date(time) >= msgDate;
          }
        ).length;
      }

      // Cap readCount at otherMembersCount to avoid weirdness if member list is stale
      readCount = Math.min(readCount, otherMembersCount);

      // If group has 0 other members (just me), isReadByAll is false or effectively irrelevant, but let's say true?
      // Actually if just me, no one to read.
      const isReadByAll =
        otherMembersCount > 0 && readCount >= otherMembersCount;

      return (
        <MessageItem
          item={
            {
              ...item,
              readInfo: {
                readCount,
                totalMembers: otherMembersCount,
                isReadByAll,
              },
              onImagePress: (url: string) => {
                setViewerImage(url);
                setViewerVisible(true);
              },
            } as any
          }
          user={user}
          colors={colors}
          isAnnouncementGroup={isAnnouncementGroup}
          showAvatar={isLastFromUser}
          onDocPress={(url, name) => {
            setDocViewerUrl(url);
            setDocViewerName(name);
            setDocViewerVisible(true);
          }}
        />
      );
    },
    [
      messages,
      user,
      colors,
      isAnnouncementGroup,
      readStatuses,
      groupMembers,
      profile,
      setViewerImage,
      setViewerVisible,
      setDocViewerUrl,
      setDocViewerName,
      setDocViewerVisible,
    ]
  );

  if (isInitialLoading) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <StatusBar
          barStyle={isDarkMode ? "light-content" : "dark-content"}
          backgroundColor={colors.background}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading chat...
          </Text>
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
        {/* Header */}
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
              <View
                style={[
                  styles.announcementBadge,
                  { backgroundColor: colors.primary + "15" },
                ]}
              >
                <Ionicons name="megaphone" size={12} color={colors.primary} />
                <Text
                  style={[styles.announcementText, { color: colors.primary }]}
                >
                  Announcement
                </Text>
              </View>
            )}
            {typingUsers.size > 0 && (
              <Text
                style={[styles.typingText, { color: colors.placeholderText }]}
              >
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
              name="information-circle-outline"
              size={26}
              color={colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Messages */}
        <Animated.View
          style={[
            styles.messageContainer,
            { opacity: fadeAnim, backgroundColor: colors.background },
          ]}
        >
          {isInitialLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : messages.length === 0 ? (
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
                  color={colors.border}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No messages yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.placeholderText },
                ]}
              >
                {canSend
                  ? "Start the conversation with a friendly message!"
                  : isAnnouncementGroup
                  ? "This is an announcement group. read-only."
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

        {/* Input Area */}
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
            {selectedFile && (
              <View
                style={[
                  styles.selectedFileContainer,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.selectedFileInfo}>
                  <Ionicons
                    name={
                      selectedFile.mimeType?.startsWith("image/")
                        ? "image"
                        : "document-text"
                    }
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.selectedFileName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {selectedFile.name}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedFile(null)}
                  style={styles.removeFileButton}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.notification || "red"}
                  />
                </TouchableOpacity>
              </View>
            )}

            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: colors.inputBackground },
              ]}
            >
              <TouchableOpacity
                style={styles.attachButton}
                onPress={pickDocument}
                disabled={isUploading}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={28}
                  color={colors.primary}
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
                  { color: colors.text },
                  !newMessage && { textAlignVertical: "center" },
                ]}
                multiline
                maxLength={500}
              />

              <TouchableOpacity
                onPress={sendMessage}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor:
                      (newMessage.trim() || selectedFile) && !sending
                        ? colors.primary
                        : "transparent",
                  },
                ]}
                disabled={(!newMessage.trim() && !selectedFile) || sending}
                activeOpacity={0.8}
              >
                {sending || isUploading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons
                    name="arrow-up"
                    size={20}
                    color={
                      (newMessage.trim() || selectedFile) && !sending
                        ? "#FFF"
                        : colors.placeholderText
                    }
                  />
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Permission Notice (Announcement) */}
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
            <Ionicons
              name="lock-closed"
              size={18}
              color="#FF6B35"
              style={{ marginRight: 8 }}
            />
            <Text style={[styles.permissionText, { color: "#FF6B35" }]}>
              This is an announcement group (Read-only).
            </Text>
          </Animated.View>
        )}

        {/* Info Modal */}
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
              <TouchableOpacity
                onPress={() => setInfoVisible(false)}
                style={styles.modalCloseButton}
              >
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

                {isGroupAdmin && (
                  <View
                    style={[
                      styles.groupControlsSection,
                      {
                        borderTopColor: colors.border,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.placeholderText },
                      ]}
                    >
                      Group Controls
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.controlButton,
                        { backgroundColor: colors.background },
                      ]}
                      onPress={() => {
                        setInfoVisible(false);
                        router.push({
                          pathname: "/(tabs)/groups",
                          params: { groupId: chatId },
                        });
                      }}
                    >
                      <View style={styles.controlButtonContent}>
                        <Ionicons
                          name="settings-outline"
                          size={20}
                          color={colors.text}
                        />
                        <Text
                          style={[
                            styles.controlButtonText,
                            { color: colors.text },
                          ]}
                        >
                          Manage Group
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={colors.placeholderText}
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {groupInfo?.created_by !== profile?.user_id && (
                  <TouchableOpacity
                    style={[styles.leaveButton]}
                    onPress={() => {
                      Alert.alert(
                        "Leave Group",
                        "Are you sure you want to leave this group?",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Leave",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                const { error } = await supabase
                                  .from("group_members")
                                  .delete()
                                  .eq("group_id", chatId)
                                  .eq("user_id", profile?.user_id);
                                if (error) throw error;
                                setInfoVisible(false);
                                router.back();
                              } catch (error: any) {
                                Alert.alert(
                                  "Error",
                                  error.message || "Failed to leave group"
                                );
                              }
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Ionicons
                      name="log-out-outline"
                      size={20}
                      color="#dc3545"
                    />
                    <Text style={styles.leaveButtonText}>Leave Group</Text>
                  </TouchableOpacity>
                )}
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

        {/* Image Viewer Modal */}
        <Modal
          visible={viewerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setViewerVisible(false)}
        >
          <View style={styles.viewerContainer}>
            <TouchableOpacity
              style={styles.viewerCloseButton}
              onPress={() => setViewerVisible(false)}
            >
              <Ionicons name="close" size={30} color="#FFF" />
            </TouchableOpacity>
            {viewerImage && (
              <Image
                source={{ uri: viewerImage }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>

        {/* Document Viewer Modal */}
        <Modal
          visible={docViewerVisible}
          transparent={false}
          animationType="slide"
          onRequestClose={() => setDocViewerVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View
              style={[
                styles.docHeader,
                {
                  borderBottomColor: colors.border,
                  paddingTop: insets.top,
                  height: 56 + insets.top,
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => setDocViewerVisible(false)}
                style={styles.docCloseButton}
              >
                <Ionicons name="close" size={28} color={colors.text} />
              </TouchableOpacity>
              <Text
                style={[styles.docTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {docViewerName}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <WebView
              source={{ uri: docViewerUrl || "" }}
              style={{ flex: 1 }}
              startInLoadingState={true}
              renderLoading={() => (
                <ActivityIndicator
                  style={styles.docLoading}
                  size="large"
                  color={colors.primary}
                />
              )}
            />
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
    paddingTop: Platform.OS === "android" ? 10 : 16,
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
    textAlign: "center",
  },
  announcementBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 2,
  },
  announcementText: {
    fontSize: 11,
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
    opacity: 0.5,
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
  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
    position: "relative",
    paddingHorizontal: 38,
  },
  rowLeft: {
    justifyContent: "flex-start",
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  messageBubble: {
    maxWidth: width * 0.75,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  senderName: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    marginLeft: 2,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: "flex-end",
    opacity: 0.8,
  },
  attachmentContainer: {
    marginBottom: 8,
    borderRadius: 10,
    overflow: "hidden",
  },
  attachedImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    borderWidth: 0.5,
  },
  fileAttachment: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.2)", // subtle border for files
  },
  fileIconContainer: {
    marginRight: 10,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "500",
  },
  fileType: {
    fontSize: 11,
    marginTop: 2,
  },
  avatarOverlay: {
    position: "absolute",
    bottom: 0,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "bold",
  },

  // Input
  inputContainer: {
    padding: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 48,
  },
  selectedFileContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  selectedFileInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  selectedFileName: {
    marginLeft: 10,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  removeFileButton: {
    padding: 4,
  },
  attachButton: {
    padding: 6,
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    maxHeight: 120, // Limit height of input
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },

  // Permission
  permissionNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderTopWidth: 0.5,
  },
  permissionText: {
    fontSize: 13,
    fontWeight: "500",
  },

  // Modal
  modalContainer: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 0,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
  },
  groupHeaderSection: {
    alignItems: "center",
    paddingVertical: 30,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  groupIconLarge: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  groupNameLarge: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  groupDescription: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 20,
  },
  groupMetaRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 8,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 13,
  },
  membersSection: {
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 10,
    paddingHorizontal: 20,
    letterSpacing: 0.5,
    opacity: 0.6,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#555",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberEmail: {
    fontSize: 13,
  },
  adminBadge: {
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#666",
  },
  groupControlsSection: {
    paddingVertical: 20,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
  },
  controlButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  controlButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  controlButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  leaveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    marginTop: 10,
    marginBottom: 20,
  },
  leaveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#dc3545",
    marginLeft: 8,
  },
  modalLoading: {
    alignItems: "center",
    marginTop: 50,
  },
  modalLoadingText: {
    marginTop: 10,
    fontSize: 14,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  viewerImage: {
    width: width,
    height: width, // Or adjust to fit better
    flex: 1,
  },
  viewerCloseButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  docHeader: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  docCloseButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  docTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginHorizontal: 10,
  },
  docLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
});
