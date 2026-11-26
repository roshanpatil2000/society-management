import { useGateContext } from '@/features/auth/AuthGate';
import { InviteScreen } from '@/features/auth/screens/InviteScreen';

export default function InviteRoute() {
  const { gate, access } = useGateContext();
  const societyId = gate.screen === 'invite' ? gate.societyId : null;
  const invite = access?.invites.find((i) => i.society_id === societyId);
  return invite ? <InviteScreen invite={invite} /> : null;
}
