// Registers this device for push notifications. Pure logic with its platform
// calls passed in, so it is testable; usePushRegistration wires the real ones.

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface PushDeps {
  platform: 'ios' | 'android' | 'web' | string;
  isDevice: boolean;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getToken(): Promise<string>;
  register(token: string, platform: 'ios' | 'android'): Promise<void>;
}

export async function registerForPush(
  deps: PushDeps,
): Promise<'registered' | 'denied' | 'unsupported'> {
  if (!deps.isDevice || (deps.platform !== 'ios' && deps.platform !== 'android'))
    return 'unsupported';
  let status = await deps.getPermission();
  if (status !== 'granted') status = await deps.requestPermission();
  if (status !== 'granted') return 'denied';
  await deps.register(await deps.getToken(), deps.platform);
  return 'registered';
}
