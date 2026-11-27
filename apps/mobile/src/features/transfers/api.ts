// Flat transfers: one committee member requests, another approves.
import { supabase } from '@/lib/supabase';

export type BuyerType = 'owner' | 'joint_owner';

export interface Buyer {
  email: string;
  full_name: string | null;
  type: BuyerType;
}

export interface PendingTransfer {
  id: string;
  flat: string;
  sellers: string[];
  buyers: Buyer[];
  transfer_date: string;
  share_cert_no: string | null;
  transfer_fee: number;
  /** The signed-in person requested it, so they cannot decide it. */
  mine: boolean;
}

export interface TransferResult {
  closed: number;
  added: number;
  invited: number;
  memberships_removed: number;
}

export async function requestTransfer(input: {
  societyId: string;
  flatId: string;
  fromOccupantIds: string[];
  buyers: Buyer[];
  transferDate: string;
  shareCertNo: string | null;
  transferFee: number;
  note: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_flat_transfer', {
    p_society_id: input.societyId,
    p_flat_id: input.flatId,
    p_from_occupant_ids: input.fromOccupantIds,
    p_buyers: input.buyers.map((b) => ({ ...b })),
    p_transfer_date: input.transferDate,
    p_transfer_fee: input.transferFee,
    ...(input.shareCertNo ? { p_share_cert_no: input.shareCertNo } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) throw error;
  return data;
}

export async function listTransfers(societyId: string): Promise<PendingTransfer[]> {
  const [{ data: session }, { data, error }] = await Promise.all([
    supabase.auth.getSession(),
    supabase
      .from('flat_transfer')
      .select(
        'id, from_occupant_ids, buyers, transfer_date, share_cert_no, transfer_fee, requested_by, flat(number, wing(name))',
      )
      .eq('society_id', societyId)
      .eq('status', 'requested')
      .is('deleted_at', null)
      .order('created_at'),
  ]);
  if (error) throw error;
  const occupantIds = (data ?? []).flatMap((t) => t.from_occupant_ids);
  const names = new Map<string, string>();
  if (occupantIds.length > 0) {
    const { data: occupants, error: occError } = await supabase
      .from('flat_occupant')
      .select('id, profiles(full_name, email)')
      .in('id', occupantIds);
    if (occError) throw occError;
    for (const o of occupants ?? [])
      names.set(o.id, o.profiles?.full_name ?? o.profiles?.email ?? '—');
  }
  const me = session.session?.user.id;
  return (data ?? []).map((t) => ({
    id: t.id,
    flat: t.flat ? `${t.flat.wing?.name ?? ''}-${t.flat.number}` : '',
    sellers: t.from_occupant_ids.map((id) => names.get(id) ?? '—'),
    buyers: t.buyers as unknown as Buyer[],
    transfer_date: t.transfer_date,
    share_cert_no: t.share_cert_no,
    transfer_fee: t.transfer_fee,
    mine: t.requested_by === me,
  }));
}

export async function decideTransfer(
  id: string,
  decision: 'approve' | 'reject',
  reason: string | null,
): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('approve_flat_transfer', {
    p_transfer_id: id,
    p_decision: decision,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as TransferResult;
}
