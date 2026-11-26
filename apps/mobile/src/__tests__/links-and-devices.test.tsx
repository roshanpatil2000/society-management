import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import * as authApi from '@/features/auth/api';
import { ScanScreen } from '@/features/auth/screens/ScanScreen';
import { SocietyLinkScreen } from '@/features/auth/screens/SocietyLinkScreen';
import { registerForPush, type PushDeps } from '@/features/devices/push';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { params, router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/auth/api');

const mockCamera = { granted: true, scan: null as null | ((r: { data: string }) => void) };
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: mockCamera.granted, canAskAgain: true }, jest.fn()],
  CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
    mockCamera.scan = props.onBarcodeScanned ?? null;
    return null;
  },
}));

const mocked = jest.mocked(authApi);
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
  mockCamera.granted = true;
  mockCamera.scan = null;
});

describe('SocietyLinkScreen (/s/<code>)', () => {
  it("opens the linked society's login", async () => {
    mocked.discoverSociety.mockResolvedValue(greenPark);
    params.code = 'GreenPark';
    await renderScreen(<SocietyLinkScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(mocked.discoverSociety).toHaveBeenCalledWith('greenpark');
    expect(useSessionStore.getState().discovered?.slug).toBe('greenpark');
  });

  it('explains a bad link and offers to type the code', async () => {
    mocked.discoverSociety.mockResolvedValue(null);
    params.code = 'nowhere';
    await renderScreen(<SocietyLinkScreen />);
    expect(await screen.findByText(/No society found/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Find society'));
    expect(router.replace).toHaveBeenCalledWith('/discover');
  });
});

describe('ScanScreen', () => {
  it('turns a scanned society QR into the society link', async () => {
    await renderScreen(<ScanScreen />);
    mockCamera.scan?.({ data: 'https://app.societyapp.in/s/greenpark' });
    expect(router.replace).toHaveBeenCalledWith('/s/greenpark');
  });

  it('ignores QR codes that are not society codes', async () => {
    await renderScreen(<ScanScreen />);
    mockCamera.scan?.({ data: 'https://example.com/' });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('asks for the camera when permission is missing', async () => {
    mockCamera.granted = false;
    await renderScreen(<ScanScreen />);
    expect(screen.getByText(/Allow camera access/)).toBeTruthy();
  });
});

describe('registerForPush', () => {
  const deps = (over: Partial<PushDeps> = {}): PushDeps => ({
    platform: 'android',
    isDevice: true,
    getPermission: jest.fn().mockResolvedValue('granted'),
    requestPermission: jest.fn().mockResolvedValue('granted'),
    getToken: jest.fn().mockResolvedValue('ExponentPushToken[abc]'),
    register: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('registers the device token', async () => {
    const d = deps();
    await expect(registerForPush(d)).resolves.toBe('registered');
    expect(d.register).toHaveBeenCalledWith('ExponentPushToken[abc]', 'android');
  });

  it('asks for permission first when not yet granted', async () => {
    const d = deps({ getPermission: jest.fn().mockResolvedValue('undetermined') });
    await registerForPush(d);
    expect(d.requestPermission).toHaveBeenCalled();
  });

  it('does nothing on the web or a simulator, and stops quietly when denied', async () => {
    expect(await registerForPush(deps({ platform: 'web' }))).toBe('unsupported');
    expect(await registerForPush(deps({ isDevice: false }))).toBe('unsupported');
    const denied = deps({
      getPermission: jest.fn().mockResolvedValue('denied'),
      requestPermission: jest.fn().mockResolvedValue('denied'),
    });
    expect(await registerForPush(denied)).toBe('denied');
    expect(denied.register).not.toHaveBeenCalled();
  });
});
