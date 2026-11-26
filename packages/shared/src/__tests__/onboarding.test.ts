import { describe, expect, it } from 'vitest';

import { onboardSocietyRequestSchema } from '../schemas/onboarding';

const valid = {
  action: 'onboard',
  society: { name: 'Green Park CHS', registration_no: 'MUM/1001' },
  committee: [{ email: ' Chair@Example.com ', full_name: 'Asha', roles: ['Chairman'] }],
};

describe('onboardSocietyRequestSchema', () => {
  it('accepts a valid request, normalises emails and defaults status to trial', () => {
    const parsed = onboardSocietyRequestSchema.parse(valid);
    expect(parsed.action).toBe('onboard');
    if (parsed.action !== 'onboard') throw new Error('unreachable');
    expect(parsed.committee[0]?.email).toBe('chair@example.com');
    expect(parsed.status).toBe('trial');
  });

  it('rejects duplicate committee emails', () => {
    const dup = { ...valid, committee: [...valid.committee, { ...valid.committee[0] }] };
    expect(onboardSocietyRequestSchema.safeParse(dup).success).toBe(false);
  });

  it('rejects an empty committee, bad email and unknown quota keys', () => {
    expect(onboardSocietyRequestSchema.safeParse({ ...valid, committee: [] }).success).toBe(false);
    expect(
      onboardSocietyRequestSchema.safeParse({
        ...valid,
        committee: [{ email: 'nope', full_name: 'A', roles: ['Chairman'] }],
      }).success,
    ).toBe(false);
    expect(
      onboardSocietyRequestSchema.safeParse({
        ...valid,
        society: { ...valid.society, quotas: { free_lunches: 1 } },
      }).success,
    ).toBe(false);
  });

  it('accepts add_committee with a society id', () => {
    const parsed = onboardSocietyRequestSchema.safeParse({
      action: 'add_committee',
      society_id: '6f1c2d8e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
      committee: valid.committee,
    });
    expect(parsed.success).toBe(true);
  });
});
