export const lightColors = {
  primary: "#007AFF",
  background: "#FFFFFF",
  card: "#FFFFFF",
  text: "#000000",
  border: "#E5E5E7",
  notification: "#FF3B30",
  headerBackground: "#F8F9FA",
  inputBackground: "#FFFFFF",
  placeholderText: "#8E8E93",
  separator: "#E5E5E7",
};

export const darkColors = {
  primary: "#0A84FF",
  background: "#121212",
  card: "#1E1E1E",
  text: "#FFFFFF",
  border: "#2C2C2E",
  notification: "#FF453A",
  headerBackground: "#1E1E1E",
  inputBackground: "#2D2D2D",
  placeholderText: "#8E8E93",
  separator: "#3A3A3C",
};

export const typography = {
  regular: "PlusJakartaDisplay_400Regular",
  medium: "PlusJakartaDisplay_500Medium",
  semiBold: "PlusJakartaDisplay_600SemiBold",
  bold: "PlusJakartaDisplay_700Bold",
};

export const getThemeColors = (isDarkMode: boolean) => {
  return isDarkMode ? darkColors : lightColors;
};
