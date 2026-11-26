import { useGateContext } from '@/features/auth/AuthGate';
import { PickerScreen } from '@/features/auth/screens/PickerScreen';

export default function PickerRoute() {
  const { access } = useGateContext();
  return <PickerScreen memberships={access?.memberships ?? []} />;
}
