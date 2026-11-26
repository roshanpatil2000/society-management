import { useGateContext } from '@/features/auth/AuthGate';
import { ProfileScreen } from '@/features/profile/ProfileScreen';

export default function ProfileRoute() {
  const { access } = useGateContext();
  return access ? <ProfileScreen access={access} /> : null;
}
