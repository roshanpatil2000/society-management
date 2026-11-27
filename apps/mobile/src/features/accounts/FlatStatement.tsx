import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, List, Text } from 'react-native-paper';

import { formatPaise } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { errorKey } from '@/lib/errors';

import { flatStatement } from './api';
import { formatDate } from './dates';

/** A flat's dues and its ledger entries, newest first. */
export function FlatStatement({ flatId }: { flatId: string }) {
  const { t } = useTranslation();
  const lines = useQuery({
    queryKey: ['flat-statement', flatId],
    queryFn: () => flatStatement(flatId),
  });

  if (lines.isPending) return <ActivityIndicator />;
  if (lines.error) return <ErrorText message={t(errorKey(lines.error))} />;
  if (lines.data.length === 0) return <Text variant="bodyMedium">{t('accounts.noEntries')}</Text>;

  const balance = lines.data[lines.data.length - 1]?.balance ?? 0;
  const summary =
    balance > 0
      ? t('accounts.balanceDue', { amount: formatPaise(balance) })
      : balance < 0
        ? t('accounts.advance', { amount: formatPaise(-balance) })
        : t('accounts.noDues');

  return (
    <List.Section title={t('accounts.statement')}>
      <Text variant="titleMedium">{summary}</Text>
      {[...lines.data].reverse().map((l) => (
        <List.Item
          key={l.id}
          title={l.narration}
          description={`${formatDate(l.entry_date)} · ${
            l.debit > 0
              ? t('accounts.due', { amount: formatPaise(l.debit) })
              : t('accounts.credit', { amount: formatPaise(l.credit) })
          }`}
          left={(p) => <List.Icon {...p} icon={l.debit > 0 ? 'arrow-up' : 'arrow-down'} />}
        />
      ))}
    </List.Section>
  );
}
