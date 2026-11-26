import { assertEquals, assertExists } from '@std/assert';

import type { EmailMessage } from '../_shared/email.ts';
import { handleOnboard, type OnboardDeps } from './handler.ts';

const ADMIN = 'admin-user-id';
const body = {
  action: 'onboard',
  society: { name: 'Green Park CHS' },
  committee: [
    { email: 'chair@example.com', full_name: 'Asha', roles: ['Chairman'] },
    { email: 'existing@example.com', full_name: 'Ravi', roles: ['Member'] },
  ],
};

function request(payload: unknown): Request {
  return new Request('http://localhost/admin-onboard-society', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

interface Recorder {
  deps: OnboardDeps;
  created: string[];
  deleted: string[];
  aborted: string[][];
  finished: { accepts: { invite_id: string; user_id: string }[]; status: string | null }[];
  sent: EmailMessage[];
}

function fakeDeps(overrides: Partial<OnboardDeps> = {}): Recorder {
  const rec: Recorder = {
    created: [],
    deleted: [],
    aborted: [],
    finished: [],
    sent: [],
    deps: {} as OnboardDeps,
  };
  rec.deps = {
    getCallerId: (token) =>
      Promise.resolve(token === 'admin-token' ? ADMIN : token === 'member-token' ? 'member' : null),
    isPlatformAdmin: (id) => Promise.resolve(id === ADMIN),
    beginOnboard: () =>
      Promise.resolve({
        society_id: 'soc-1',
        invites: [
          { invite_id: 'inv-1', email: 'chair@example.com', full_name: 'Asha' },
          { invite_id: 'inv-2', email: 'existing@example.com', full_name: 'Ravi' },
        ],
      }),
    beginAddCommittee: () => Promise.reject(new Error('not used')),
    findUsers: () => Promise.resolve(new Map([['existing@example.com', 'user-existing']])),
    createUser: (email) => {
      const id = `user-${email}`;
      rec.created.push(id);
      return Promise.resolve(id);
    },
    deleteUser: (id) => {
      rec.deleted.push(id);
      return Promise.resolve();
    },
    finish: (_actor, _sid, accepts, status) => {
      rec.finished.push({ accepts, status });
      return Promise.resolve();
    },
    abort: (_actor, _sid, inviteIds) => {
      rec.aborted.push(inviteIds);
      return Promise.resolve();
    },
    sendEmail: (m) => {
      rec.sent.push(m);
      return Promise.resolve();
    },
    societyName: () => Promise.resolve('Green Park CHS'),
    appUrl: 'http://localhost:8081',
    ...overrides,
  };
  return rec;
}

Deno.test('rejects a missing or invalid token with 401', async () => {
  const { deps } = fakeDeps();
  assertEquals((await handleOnboard(request(body), deps, null)).status, 401);
  assertEquals((await handleOnboard(request(body), deps, 'garbage')).status, 401);
});

Deno.test('rejects a signed-in non-admin with 403 and changes nothing', async () => {
  const rec = fakeDeps();
  const res = await handleOnboard(request(body), rec.deps, 'member-token');
  assertEquals(res.status, 403);
  assertEquals(rec.created.length + rec.finished.length, 0);
});

Deno.test('rejects an invalid body with 400 before touching the database', async () => {
  const rec = fakeDeps();
  const res = await handleOnboard(request({ ...body, committee: [] }), rec.deps, 'admin-token');
  assertEquals(res.status, 400);
  assertEquals(rec.finished.length, 0);
});

Deno.test(
  'creates only missing accounts, finishes with trial and sends welcome emails',
  async () => {
    const rec = fakeDeps();
    const res = await handleOnboard(request(body), rec.deps, 'admin-token');
    assertEquals(res.status, 200);
    const out = await res.json();
    assertEquals(out.society_id, 'soc-1');
    assertEquals(out.accounts_created, 1);
    assertEquals(rec.created, ['user-chair@example.com']);
    assertEquals(rec.finished[0]?.status, 'trial');
    assertEquals(rec.finished[0]?.accepts, [
      { invite_id: 'inv-1', user_id: 'user-chair@example.com' },
      { invite_id: 'inv-2', user_id: 'user-existing' },
    ]);
    assertEquals(
      rec.sent.map((m) => m.to),
      ['chair@example.com', 'existing@example.com'],
    );
  },
);

Deno.test('rolls back created users and aborts when finishing fails', async () => {
  const rec = fakeDeps({ finish: () => Promise.reject(new Error('invite_not_pending')) });
  const res = await handleOnboard(request(body), rec.deps, 'admin-token');
  assertEquals(res.status, 500);
  const out = await res.json();
  assertEquals(out.error.details.rolled_back, true);
  assertEquals(rec.deleted, ['user-chair@example.com']);
  assertEquals(rec.aborted, [['inv-1', 'inv-2']]);
  assertEquals(rec.sent.length, 0);
});

Deno.test('rolls back when creating a later account fails', async () => {
  let calls = 0;
  const rec = fakeDeps({
    findUsers: () => Promise.resolve(new Map()),
    createUser: (email) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('could not create account'));
      rec.created.push(`user-${email}`);
      return Promise.resolve(`user-${email}`);
    },
  });
  const res = await handleOnboard(request(body), rec.deps, 'admin-token');
  assertEquals(res.status, 500);
  assertEquals(rec.deleted, ['user-chair@example.com']);
  assertEquals(rec.aborted.length, 1);
});

Deno.test('reports welcome email failures without rolling back', async () => {
  const rec = fakeDeps({ sendEmail: () => Promise.reject(new Error('provider down')) });
  const res = await handleOnboard(request(body), rec.deps, 'admin-token');
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.welcome_email_failures.length, 2);
  assertEquals(rec.deleted.length, 0);
  assertExists(rec.finished[0]);
});

Deno.test('add_committee finishes without changing society status', async () => {
  const rec = fakeDeps({
    beginAddCommittee: () =>
      Promise.resolve({
        society_id: 'soc-1',
        invites: [{ invite_id: 'inv-9', email: 'new@example.com', full_name: 'New' }],
      }),
  });
  const res = await handleOnboard(
    request({
      action: 'add_committee',
      society_id: '6f1c2d8e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
      committee: [{ email: 'new@example.com', full_name: 'New', roles: ['Member'] }],
    }),
    rec.deps,
    'admin-token',
  );
  assertEquals(res.status, 200);
  assertEquals(rec.finished[0]?.status, null);
});
