import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { ThemedText as Text } from "./ThemedText";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  colors: [string, string];
  style?: ViewStyle;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  colors,
  style,
}) => {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.statCard, style]}
    >
      <View style={styles.statIconBadge}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
      </View>
      <Text style={styles.statValueLight}>{value}</Text>
      <Text style={styles.statLabelLight}>{label}</Text>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 24,
    alignItems: "flex-start",
  },
  statIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  statValueLight: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  statLabelLight: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 4,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
