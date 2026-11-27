import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function SocietyStackLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: t('tabs.society'),
        headerBackTitle: t('app.back'),
      }}
    />
  );
}
