import { DarkTheme as NavDark, DefaultTheme as NavLight } from 'expo-router';
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

// One palette for Paper components and the navigator (tab bar, screen background),
// so text, cards and backgrounds always match, in light and dark mode.
export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, primary: '#1F6FEB', secondary: '#0E9F6E' },
};
export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: { ...MD3DarkTheme.colors, primary: '#79A8FF', secondary: '#4FD1A5' },
};

function navigationTheme(base: typeof NavLight, paper: MD3Theme): typeof NavLight {
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: paper.colors.primary,
      background: paper.colors.background,
      card: paper.colors.surface,
      text: paper.colors.onSurface,
      border: paper.colors.outlineVariant,
      notification: paper.colors.error,
    },
  };
}

export const navigationLight = navigationTheme(NavLight, lightTheme);
export const navigationDark = navigationTheme(NavDark, darkTheme);
