import { useGateContext } from '@/features/auth/AuthGate';
import { HomeScreen } from '@/features/home/HomeScreen';

export default function HomeRoute() {
  const { access } = useGateContext();
  return access ? <HomeScreen access={access} /> : null;
}
