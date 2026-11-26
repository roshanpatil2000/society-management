// Shared expo-router mock for screen tests. Import in a test file with:
//   jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissAll: jest.fn(),
};
export const params: Record<string, string> = {};

export const routerMock = {
  useRouter: () => router,
  router,
  useLocalSearchParams: () => params,
  Link: ({ children }: { children: unknown }) => children,
  Redirect: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
};
