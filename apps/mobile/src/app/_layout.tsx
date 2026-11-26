import '@/i18n';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { AuthGate } from '@/features/auth/AuthGate';
import { darkTheme, lightTheme, navigationDark, navigationLight } from '@/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );
  const dark = useColorScheme() === 'dark';
  return (
    <QueryClientProvider client={queryClient}>
      <PaperProvider theme={dark ? darkTheme : lightTheme}>
        <ThemeProvider value={dark ? navigationDark : navigationLight}>
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthGate>
          <StatusBar style="auto" />
        </ThemeProvider>
      </PaperProvider>
    </QueryClientProvider>
  );
}
