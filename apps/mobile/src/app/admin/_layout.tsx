import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminGuard } from '@/features/admin/AdminGuard';
import { useGateContext } from '@/features/auth/AuthGate';

export default function AdminLayout() {
  const { t } = useTranslation();
  const { access } = useGateContext();
  return (
    <AdminGuard isPlatformAdmin={access?.isPlatformAdmin ?? false}>
      <Stack screenOptions={{ title: t('admin.title') }} />
    </AdminGuard>
  );
}
