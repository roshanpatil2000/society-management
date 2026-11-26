import { StyleSheet, Text, View } from 'react-native';

import { APP_NAME } from '@/lib/app-info';

// Placeholder home screen. M3 replaces this with the (auth) and (app) route groups.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text>Setup complete. Login arrives in M3.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  title: { fontSize: 24, fontWeight: '600' },
});
