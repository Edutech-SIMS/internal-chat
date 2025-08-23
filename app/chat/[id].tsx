import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
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
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

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

  const { user } = useAuth();
  const params = useLocalSearchParams();
  const router = useRouter();

  const chatId = params.id as string;
  const chatName = params.name as string;

  useEffect(() => {
    if (infoVisible) {
      fetchGroupInfo();
    }
  }, [infoVisible]);

  const fetchGroupInfo = async () => {
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, description, created_at")
      .eq("id", chatId)
      .single();

    if (error) {
      console.error("Error fetching group info:", error);
    } else {
      setGroupInfo(data);
    }
  };

  useEffect(() => {
    fetchMessages();
    setupRealtime();
  }, [chatId]);

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

    const { error } = await supabase.from("messages").insert([
      {
        content: newMessage,
        user_id: user?.id,
        group_id: chatId,
      },
    ]);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setNewMessage("");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{chatName || "Chat"}</Text>
          <TouchableOpacity onPress={() => setInfoVisible(true)}>
            <Ionicons
              name="information-circle-outline"
              size={24}
              color="#007AFF"
            />
          </TouchableOpacity>
        </View>

        {/* Messages List */}
        {messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={60}
              color="#ccc"
            />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to start the conversation!
            </Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.messageContainer,
                  item.profiles?.full_name === user?.user_metadata?.full_name &&
                    styles.myMessage,
                ]}
              >
                <Text style={styles.senderName}>
                  {item.profiles?.full_name || "Unknown User"}
                </Text>
                <Text
                  style={[
                    styles.messageText,
                    item.profiles?.full_name ===
                      user?.user_metadata?.full_name && styles.myMessageText,
                  ]}
                >
                  {item.content || ""}
                </Text>
                <Text style={styles.timestamp}>
                  {new Date(item.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            )}
            contentContainerStyle={styles.messagesList}
          />
        )}

        {/* Message Input */}
        <View style={styles.inputContainer}>
          <TextInput
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Type a message..."
            style={styles.input}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            onPress={sendMessage}
            style={[
              styles.sendButton,
              !newMessage.trim() && styles.sendButtonDisabled,
            ]}
            disabled={!newMessage.trim()}
          >
            <Ionicons name="send" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Group Info Modal */}
        <Modal
          visible={infoVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setInfoVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>📌 Group Info</Text>
                <TouchableOpacity onPress={() => setInfoVisible(false)}>
                  <Ionicons name="close" size={26} color="#333" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalContent}>
                {groupInfo ? (
                  <>
                    <Text style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Name: </Text>
                      {groupInfo.name}
                    </Text>
                    {groupInfo.description && (
                      <Text style={styles.infoItem}>
                        <Text style={styles.infoLabel}>Description: </Text>
                        {groupInfo.description}
                      </Text>
                    )}
                    <Text style={styles.infoItem}>
                      <Text style={styles.infoLabel}>Created: </Text>
                      {new Date(groupInfo.created_at).toLocaleDateString()}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.infoItem}>Loading...</Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setInfoVisible(false)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 15,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginTop: 15,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  messagesList: {
    padding: 15,
  },
  messageContainer: {
    backgroundColor: "white",
    padding: 15,
    borderRadius: 15,
    marginBottom: 15,
    maxWidth: "80%",
    alignSelf: "flex-start",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  myMessage: {
    backgroundColor: "#007AFF",
    alignSelf: "flex-end",
  },
  senderName: {
    fontWeight: "bold",
    color: "#333",
    marginBottom: 5,
    fontSize: 12,
  },
  messageText: {
    color: "#333",
    fontSize: 16,
    lineHeight: 20,
  },
  myMessageText: {
    color: "white",
  },
  timestamp: {
    fontSize: 11,
    color: "#999",
    marginTop: 5,
    alignSelf: "flex-end",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 15,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalContainer: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    minHeight: "30%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  modalContent: {
    gap: 12,
    marginBottom: 20,
  },
  infoItem: {
    fontSize: 15,
    color: "#444",
  },
  infoLabel: {
    fontWeight: "600",
    color: "#222",
  },
  closeButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  closeButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
