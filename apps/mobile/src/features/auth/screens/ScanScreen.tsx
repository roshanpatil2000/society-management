import { CameraView, useCameraPermissions } from 'expo-camera';
import { type Href, useRouter } from 'expo-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { normalizeSocietyCode } from '@society/shared';

import { Screen } from '@/components/Screen';

/** Scans the society QR from the notice board and opens that society's login. */
export function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission?.granted) {
    return (
      <Screen>
        <Text variant="bodyLarge">{t('discovery.cameraDenied')}</Text>
        {permission?.canAskAgain !== false ? (
          <Button mode="contained" onPress={() => void requestPermission()}>
            {t('app.continue')}
          </Button>
        ) : null}
        <Button onPress={() => router.replace('/discover')}>{t('app.back')}</Button>
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          const slug = normalizeSocietyCode(data);
          if (!slug || handled.current) return;
          handled.current = true;
          router.replace(`/s/${slug}` as Href);
        }}
      />
      <Button
        style={styles.back}
        mode="contained-tonal"
        onPress={() => router.replace('/discover')}
      >
        {t('app.back')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  back: { position: 'absolute', bottom: 48, alignSelf: 'center' },
});
