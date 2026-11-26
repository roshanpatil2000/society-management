import { useGateContext } from '@/features/auth/AuthGate';
import { ConsentScreen } from '@/features/auth/screens/ConsentScreen';

export default function ConsentRoute() {
  const { gate, access } = useGateContext();
  const societyId = gate.screen === 'consent' ? gate.societyId : null;
  const name = access?.memberships.find((m) => m.society_id === societyId)?.society_name ?? '';
  return <ConsentScreen societyName={name} />;
}
