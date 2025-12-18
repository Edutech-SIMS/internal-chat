import { forwardRef } from "react";
import { StyleSheet, Text, TextProps } from "react-native";

export type ThemedTextProps = TextProps & {
  type?: "default" | "title" | "defaultSemiBold" | "subtitle" | "link";
};

export const ThemedText = forwardRef<Text, ThemedTextProps>(
  ({ style, type = "default", ...rest }, ref) => {
    // Extract fontWeight from style if possible, or defaulting logic could go here.
    // However, simpler is to use `fontFamily` based on the requested weight or type.

    // Flatten style to checking fontWeight
    const flatStyle = StyleSheet.flatten(style);

    // Helper to determing font family
    const getFontFamily = () => {
      // If a type is provided, use that
      switch (type) {
        case "title":
          return "PlusJakartaSans-Bold";
        case "defaultSemiBold":
        case "subtitle":
          return "PlusJakartaSans-SemiBold";
        case "link":
          return "PlusJakartaSans-Medium";
        default:
          // Check generic fontWeight from style
          if (flatStyle?.fontWeight) {
            const weight = String(flatStyle.fontWeight);
            if (["700", "800", "bold"].includes(weight)) {
              return "PlusJakartaSans-Bold";
            }
            if (["600", "500", "semibold", "medium"].includes(weight)) {
              return "PlusJakartaSans-Medium"; // or SemiBold depending on preference
            }
          }
          return "PlusJakartaSans-Regular";
      }
    };

    return (
      <Text
        ref={ref}
        style={[
          { fontFamily: getFontFamily(), includeFontPadding: false },
          type === "default" ? styles.default : undefined,
          type === "title" ? styles.title : undefined,
          type === "defaultSemiBold" ? styles.defaultSemiBold : undefined,
          type === "subtitle" ? styles.subtitle : undefined,
          type === "link" ? styles.link : undefined,
          style,
        ]}
        {...rest}
      />
    );
  }
);

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
  },
  defaultSemiBold: {
    fontSize: 16,
    // fontWeight: '600', // Handled by fontFamily
  },
  title: {
    fontSize: 32,
    // fontWeight: 'bold', // Handled by fontFamily
  },
  subtitle: {
    fontSize: 20,
    // fontWeight: 'bold', // Handled by fontFamily
  },
  link: {
    fontSize: 16,
    color: "#0a7ea4",
  },
});
