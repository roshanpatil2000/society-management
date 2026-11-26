import { useGateContext } from '@/features/auth/AuthGate';
import { NotMemberScreen } from '@/features/auth/screens/NotMemberScreen';

export default function NotMemberRoute() {
  const { access, session } = useGateContext();
  return (
    <NotMemberScreen
      email={access?.email ?? session?.user.email ?? ''}
      hasOtherSocieties={(access?.memberships.length ?? 0) > 0}
    />
  );
}
