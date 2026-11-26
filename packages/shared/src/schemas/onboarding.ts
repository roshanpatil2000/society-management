// Request schema for the admin-onboard-society Edge Function. Imports only zod and
// the self-contained society-code module, so the Deno function can import it directly.
import { z } from 'zod';

import { isValidSocietySlug, normalizeSocietyCode } from '../society-code.ts';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const committeeMemberSchema = z.object({
  email,
  full_name: z.string().trim().min(1, 'Name is required').max(120),
  roles: z.array(z.string().trim().min(1)).min(1, 'Pick at least one role'),
});

const quotaValue = z.number().int().min(0);

export const quotasSchema = z
  .object({
    max_flats: quotaValue,
    max_members: quotaValue,
    emails_per_month: quotaValue,
    whatsapp_per_month: quotaValue,
    sms_per_month: quotaValue,
    storage_mb: quotaValue,
    invites_per_day: quotaValue,
  })
  .partial()
  .strict();

const societySlug = z
  .string()
  .transform((v) => normalizeSocietyCode(v) ?? v.trim().toLowerCase())
  .refine(isValidSocietySlug, {
    message:
      'Society code must be 3 to 30 letters, digits or single hyphens, and not a reserved word',
  });

export const societyDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Society name is required').max(200),
  slug: societySlug,
  registration_no: optionalText(80),
  address: optionalText(500),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN must be 15 characters')
    .optional(),
  plan: optionalText(40),
  financial_year_start_month: z.number().int().min(1).max(12).optional(),
  quotas: quotasSchema.optional(),
});

const committee = z
  .array(committeeMemberSchema)
  .min(1, 'Add at least one committee member')
  .max(20)
  .refine((people) => new Set(people.map((p) => p.email)).size === people.length, {
    message: 'Each committee email must be unique',
  });

export const onboardSocietyRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('onboard'),
    society: societyDetailsSchema,
    committee,
    status: z.enum(['trial', 'active']).default('trial'),
    trial_ends_at: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({
    action: z.literal('add_committee'),
    society_id: z.uuid(),
    committee,
  }),
]);

export type CommitteeMember = z.infer<typeof committeeMemberSchema>;
export type OnboardSocietyRequest = z.infer<typeof onboardSocietyRequestSchema>;
