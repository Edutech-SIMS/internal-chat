import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";

interface ThemeContextType {
  isDarkMode: boolean;
  toggleDarkMode: (value?: boolean) => void;
  setIsDarkMode: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDarkMode: false,
  toggleDarkMode: () => {},
  setIsDarkMode: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const systemColorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    console.log("ThemeContext mounted, loading theme preference");
    loadThemePreference();
  }, []);

  useEffect(() => {
    console.log("isDarkMode state updated:", isDarkMode);
  }, [isDarkMode]);

  const loadThemePreference = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem("themePreference");
      if (savedTheme !== null) {
        setIsDarkMode(savedTheme === "dark");
      } else {
        // Default to system preference if no saved preference
        setIsDarkMode(systemColorScheme === "dark");
      }
    } catch (error) {
      console.error("Error loading theme preference:", error);
      // Fallback to system preference
      setIsDarkMode(systemColorScheme === "dark");
    }
  };

  const toggleDarkMode = async (value?: boolean) => {
    console.log("Toggling dark mode, current value:", isDarkMode);
    const newMode = value !== undefined ? value : !isDarkMode;
    console.log("New mode will be:", newMode);
    setIsDarkMode(newMode);
    console.log("isDarkMode state set to:", newMode);
    try {
      await AsyncStorage.setItem("themePreference", newMode ? "dark" : "light");
      console.log("Theme preference saved:", newMode ? "dark" : "light");
    } catch (error) {
      console.error("Error saving theme preference:", error);
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        isDarkMode,
        toggleDarkMode,
        setIsDarkMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
