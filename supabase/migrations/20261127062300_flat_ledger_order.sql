-- flat_ledger also exposes the line id and the entry's creation time, so apps
-- can list a statement in the same order the running balance uses.
create or replace view public.flat_ledger with (security_invoker = true) as
select
  l.society_id,
  l.flat_id,
  e.id as journal_entry_id,
  e.entry_date,
  e.source_type,
  e.source_id,
  e.narration,
  l.debit,
  l.credit,
  (sum(l.debit - l.credit) over (
     partition by l.flat_id
     order by e.entry_date, e.created_at, l.id
     rows between unbounded preceding and current row))::bigint as balance,
  l.id as journal_line_id,
  e.created_at
from public.journal_line l
join public.journal_entry e on e.id = l.journal_entry_id
join public.ledger_account a on a.id = l.ledger_account_id
where a.system_key in ('member_receivables', 'member_advances');
