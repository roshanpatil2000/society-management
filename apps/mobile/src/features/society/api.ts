// Society management calls (wings, flats, occupants, invites, flat import).
// Row-level security decides what each person may read or change.
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type OccupantType = 'owner' | 'joint_owner' | 'tenant';

export interface FlatSummary {
  id: string;
  wing: string;
  number: string;
  floor: number | null;
  area_sqft: number | null;
  flat_type: string | null;
  occupants: { id: string; name: string; type: OccupantType }[];
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  full_name: string | null;
  flat: string | null;
  expires_at: string;
  status: string;
}

export interface ImportReport {
  ok: boolean;
  wings_created: number;
  flats_created: number;
  invites_created: number;
  errors: { row: number; field: string; message: string }[];
}

function fail(error: { message: string } | null): void {
  if (error) throw error;
}

const today = () => new Date().toISOString().slice(0, 10);
const isCurrent = (o: { deleted_at: string | null; to_date: string | null }) =>
  o.deleted_at === null && (o.to_date === null || o.to_date >= today());

export async function listFlats(societyId: string): Promise<FlatSummary[]> {
  const { data, error } = await supabase
    .from('flat')
    .select(
      'id, number, floor, area_sqft, flat_type, wing(name, sort_order), flat_occupant(id, type, to_date, deleted_at, profiles(full_name, email))',
    )
    .eq('society_id', societyId)
    .is('deleted_at', null);
  fail(error);
  return (data ?? [])
    .map((f) => ({
      id: f.id,
      wing: f.wing?.name ?? '',
      sort: f.wing?.sort_order ?? 0,
      number: f.number,
      floor: f.floor,
      area_sqft: f.area_sqft,
      flat_type: f.flat_type,
      occupants: (f.flat_occupant ?? []).filter(isCurrent).map((o) => ({
        id: o.id,
        name: o.profiles?.full_name ?? o.profiles?.email ?? '—',
        type: o.type as OccupantType,
      })),
    }))
    .sort(
      (a, b) =>
        a.sort - b.sort ||
        a.wing.localeCompare(b.wing) ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    .map(({ sort: _sort, ...flat }) => flat);
}

export async function listRoles(societyId: string): Promise<RoleOption[]> {
  const { data, error } = await supabase
    .from('role')
    .select('id, name')
    .eq('society_id', societyId)
    .is('deleted_at', null)
    .order('name');
  fail(error);
  return data ?? [];
}

export async function createInvite(input: {
  societyId: string;
  email: string;
  fullName: string | null;
  roleIds: string[];
  flatId: string | null;
  occupantType: OccupantType | null;
}): Promise<{ invite_id: string; token: string; expires_at: string }> {
  const { data, error } = await supabase.rpc('create_invite', {
    p_society_id: input.societyId,
    p_email: input.email,
    p_role_ids: input.roleIds,
    ...(input.fullName ? { p_full_name: input.fullName } : {}),
    ...(input.flatId ? { p_flat_id: input.flatId } : {}),
    ...(input.occupantType ? { p_occupant_type: input.occupantType } : {}),
  });
  fail(error);
  const row = data?.[0];
  if (!row) throw new Error('empty response');
  return row;
}

export async function listInvites(societyId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('invite')
    .select('id, email, full_name, expires_at, status, flat(number, wing(name))')
    .eq('society_id', societyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    full_name: i.full_name,
    expires_at: i.expires_at,
    status: i.status,
    flat: i.flat ? `${i.flat.wing?.name ?? ''}-${i.flat.number}` : null,
  }));
}

export async function resendInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('resend_invite', { p_invite_id: id });
  fail(error);
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { p_invite_id: id });
  fail(error);
}

export async function importFlats(
  societyId: string,
  base64: string,
  dryRun: boolean,
): Promise<ImportReport> {
  const { data, error } = await supabase.functions.invoke<ImportReport>('import-flats', {
    body: { society_id: societyId, file_base64: base64, dry_run: dryRun },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    const detail = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw { message: detail?.message ?? detail?.code ?? error.message };
  }
  if (!data) throw new Error('empty response');
  return data;
}

const SPREADSHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/comma-separated-values',
];

/** Lets the person pick an Excel or CSV file and returns it as base64, or null if cancelled. */
export async function pickSpreadsheet(): Promise<{ name: string; base64: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: SPREADSHEET_TYPES,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web' && asset.file) {
    const buffer = await asset.file.arrayBuffer();
    let binary = '';
    new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
    return { name: asset.name, base64: btoa(binary) };
  }
  const { File } = await import('expo-file-system');
  return { name: asset.name, base64: await new File(asset.uri).base64() };
}

export async function myFlats(
  societyId: string,
): Promise<{ id: string; label: string; type: OccupantType }[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('flat_occupant')
    .select('id, type, to_date, deleted_at, flat(id, number, wing(name))')
    .eq('society_id', societyId)
    .eq('user_id', userId);
  fail(error);
  return (data ?? []).filter(isCurrent).flatMap((o) =>
    o.flat
      ? [
          {
            id: o.flat.id,
            label: `${o.flat.wing?.name ?? ''}-${o.flat.number}`,
            type: o.type as OccupantType,
          },
        ]
      : [],
  );
}
