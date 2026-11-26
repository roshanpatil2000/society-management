import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import * as api from '@/features/auth/api';
import { ConsentScreen } from '@/features/auth/screens/ConsentScreen';
import { DiscoverScreen } from '@/features/auth/screens/DiscoverScreen';
import { InviteScreen } from '@/features/auth/screens/InviteScreen';
import { LoginScreen } from '@/features/auth/screens/LoginScreen';
import { NotMemberScreen } from '@/features/auth/screens/NotMemberScreen';
import { PickerScreen } from '@/features/auth/screens/PickerScreen';
import { VerifyScreen } from '@/features/auth/screens/VerifyScreen';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { params, router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/auth/api');
const mocked = jest.mocked(api);

const greenPark = {
  society_id: 'gp-id',
  slug: 'greenpark',
  name: 'Green Park CHS',
  city: 'Andheri West, Mumbai',
  logo_url: null,
  login_methods: ['email_otp', 'google'],
};

beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.getState().reset();
  for (const k of Object.keys(params)) delete params[k];
});

describe('DiscoverScreen', () => {
  it('finds a society by code, confirms it and goes to its login', async () => {
    mocked.discoverSociety.mockResolvedValue(greenPark);
    await renderScreen(<DiscoverScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society code'), 'GreenPark');
    await fireEvent.press(screen.getByText('Find society'));
    expect(await screen.findByText('Green Park CHS')).toBeTruthy();
    expect(screen.getByText('Andheri West, Mumbai')).toBeTruthy();
    expect(mocked.discoverSociety).toHaveBeenCalledWith('greenpark');
    await fireEvent.press(screen.getByText('Yes, continue'));
    expect(useSessionStore.getState().discovered?.slug).toBe('greenpark');
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('rejects a badly formed code without calling the server', async () => {
    await renderScreen(<DiscoverScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society code'), 'a b');
    await fireEvent.press(screen.getByText('Find society'));
    expect(await screen.findByText(/3 to 30 letters/)).toBeTruthy();
    expect(mocked.discoverSociety).not.toHaveBeenCalled();
  });

  it('says so when no society has that code', async () => {
    mocked.discoverSociety.mockResolvedValue(null);
    await renderScreen(<DiscoverScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society code'), 'nowhere');
    await fireEvent.press(screen.getByText('Find society'));
    expect(await screen.findByText(/No society found/)).toBeTruthy();
  });
});

describe('DiscoverScreen super-admin entry', () => {
  it('lets the super-admin, who belongs to no society, go straight to sign-in', async () => {
    await renderScreen(<DiscoverScreen />);
    await fireEvent.press(screen.getByText('Super-admin sign in'));
    expect(router.push).toHaveBeenCalledWith('/login');
  });
});

describe('LoginScreen', () => {
  beforeEach(() => useSessionStore.getState().chooseSociety(greenPark));

  it('is branded for the discovered society and offers only its login methods', async () => {
    useSessionStore.getState().chooseSociety({ ...greenPark, login_methods: ['email_otp'] });
    await renderScreen(<LoginScreen />);
    expect(screen.getByText('Sign in to Green Park CHS')).toBeTruthy();
    expect(screen.queryByText('Continue with Google')).toBeNull();
  });

  it('refuses an invalid email', async () => {
    await renderScreen(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'nope');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(mocked.sendCode).not.toHaveBeenCalled();
  });

  it('sends a code and moves to the code screen', async () => {
    mocked.sendCode.mockResolvedValue(undefined);
    await renderScreen(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email address'), ' Ravi@Example.com ');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    await waitFor(() =>
      expect(mocked.sendCode).toHaveBeenCalledWith('ravi@example.com', undefined),
    );
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/verify',
      params: { email: 'ravi@example.com' },
    });
  });

  it('explains when the email is not registered with any society', async () => {
    mocked.sendCode.mockRejectedValue({
      message: "This email isn't registered with any society. Ask your committee.",
    });
    await renderScreen(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'stranger@example.com');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    expect(await screen.findByText(/isn't registered with any society/)).toBeTruthy();
  });

  it('can go back to choose another society', async () => {
    await renderScreen(<LoginScreen />);
    await fireEvent.press(screen.getByText('Change society'));
    expect(useSessionStore.getState().discovered).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/discover');
  });
});

describe('VerifyScreen', () => {
  beforeEach(() => {
    useSessionStore.getState().chooseSociety(greenPark);
    params.email = 'ravi@example.com';
  });

  it('signs in with the emailed code', async () => {
    mocked.verifyCode.mockResolvedValue(undefined);
    await renderScreen(<VerifyScreen />);
    expect(screen.getByText(/ravi@example.com/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Sign-in code'), '123456');
    await fireEvent.press(screen.getByText('Sign in'));
    await waitFor(() =>
      expect(mocked.verifyCode).toHaveBeenCalledWith('ravi@example.com', '123456'),
    );
  });

  it('shows a clear message for a wrong or expired code', async () => {
    mocked.verifyCode.mockRejectedValue({
      message: 'Token has expired or is invalid',
      code: 'otp_expired',
    });
    await renderScreen(<VerifyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Sign-in code'), '000000');
    await fireEvent.press(screen.getByText('Sign in'));
    expect(await screen.findByText(/wrong or has expired/)).toBeTruthy();
  });
});

describe('NotMemberScreen', () => {
  beforeEach(() => useSessionStore.getState().chooseSociety(greenPark));

  it('explains, and "Use a different email" signs out but keeps the society', async () => {
    mocked.signOut.mockResolvedValue(undefined);
    await renderScreen(<NotMemberScreen email="ravi@example.com" />);
    expect(screen.getByText('Not a member of Green Park CHS')).toBeTruthy();
    await fireEvent.press(screen.getByText('Use a different email'));
    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(useSessionStore.getState().discovered?.slug).toBe('greenpark');
  });

  it('"Change society" forgets the society and signs out', async () => {
    mocked.signOut.mockResolvedValue(undefined);
    await renderScreen(<NotMemberScreen email="ravi@example.com" />);
    await fireEvent.press(screen.getByText('Change society'));
    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(useSessionStore.getState().discovered).toBeNull();
  });
});

describe('NotMemberScreen for someone who belongs to another society', () => {
  beforeEach(() => useSessionStore.getState().chooseSociety(greenPark));

  it('goes back to their own societies without signing out', async () => {
    await renderScreen(<NotMemberScreen email="ravi@example.com" hasOtherSocieties />);
    await fireEvent.press(screen.getByText('Back to my societies'));
    expect(useSessionStore.getState().discovered).toBeNull();
    expect(mocked.signOut).not.toHaveBeenCalled();
  });
});

describe('InviteScreen', () => {
  it('accepts the pending invite for the society', async () => {
    mocked.acceptInvite.mockResolvedValue('membership-id');
    await renderScreen(
      <InviteScreen
        invite={{ token: 'tok-1', society_name: 'Green Park CHS', role_names: ['Member'] }}
      />,
    );
    expect(screen.getByText("You're invited to Green Park CHS")).toBeTruthy();
    expect(screen.getByText('Accept to join as Member.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Accept invite'));
    await waitFor(() => expect(mocked.acceptInvite).toHaveBeenCalledWith('tok-1'));
  });
});

describe('ConsentScreen', () => {
  it('records acceptance of the current notice', async () => {
    mocked.acceptConsent.mockResolvedValue(undefined);
    await renderScreen(<ConsentScreen societyName="Green Park CHS" />);
    expect(screen.getByText(/Green Park CHS uses Society App/)).toBeTruthy();
    await fireEvent.press(screen.getByText('I agree'));
    await waitFor(() => expect(mocked.acceptConsent).toHaveBeenCalledWith(1));
  });

  it('lets someone who does not agree sign out instead', async () => {
    mocked.signOut.mockResolvedValue(undefined);
    await renderScreen(<ConsentScreen societyName="Green Park CHS" />);
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(mocked.acceptConsent).not.toHaveBeenCalled();
  });
});

describe('PickerScreen', () => {
  it("lists the user's societies and opens the one picked", async () => {
    await renderScreen(
      <PickerScreen
        memberships={[
          { society_id: 'gp-id', society_name: 'Green Park CHS', role_names: ['Chairman'] },
          { society_id: 'br-id', society_name: 'Blue Ridge CHS', role_names: ['Member'] },
        ]}
      />,
    );
    await fireEvent.press(screen.getByText('Blue Ridge CHS'));
    expect(useSessionStore.getState().activeSocietyId).toBe('br-id');
    expect(screen.getByText('Join another society')).toBeTruthy();
  });
});
