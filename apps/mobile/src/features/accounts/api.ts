// Accounts calls: a flat's statement and the opening-balances import.
// Row-level security decides which flats a person can see.
import { supabase } from '@/lib/supabase';

export interface StatementLine {
  id: string;
  entry_date: string;
  narration: string;
  source_type: string;
  debit: number;
  credit: number;
  /** Running balance in paise; positive means the flat owes. */
  balance: number;
}

export interface OpeningProblem {
  sheet: 'flats' | 'accounts' | 'file';
  row: number;
  field: string;
  message: string;
}

export interface OpeningReport {
  ok: boolean;
  entry_id: string | null;
  flats: number;
  total_debit: number;
  total_credit: number;
  errors: OpeningProblem[];
}

export async function flatStatement(flatId: string): Promise<StatementLine[]> {
  const { data, error } = await supabase
    .from('flat_ledger')
    .select('journal_line_id, entry_date, narration, source_type, debit, credit, balance')
    .eq('flat_id', flatId)
    .order('entry_date')
    .order('created_at')
    .order('journal_line_id');
  if (error) throw error;
  return (data ?? []).map((l) => ({
    id: l.journal_line_id ?? '',
    entry_date: l.entry_date ?? '',
    narration: l.narration ?? '',
    source_type: l.source_type ?? '',
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    balance: l.balance ?? 0,
  }));
}

export async function importOpeningBalances(
  societyId: string,
  asOf: string,
  base64: string,
  dryRun: boolean,
): Promise<OpeningReport> {
  const { data, error } = await supabase.functions.invoke<OpeningReport>(
    'import-opening-balances',
    {
      body: { society_id: societyId, as_of: asOf, file_base64: base64, dry_run: dryRun },
    },
  );
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    const detail = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw { message: detail?.message ?? detail?.code ?? error.message };
  }
  if (!data) throw new Error('empty response');
  return data;
}
