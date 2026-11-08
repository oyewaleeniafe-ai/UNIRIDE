import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingView, Row, Screen, SectionTitle } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime, kobo, shortDate } from '@/lib/format';
import type { EarningsResponse } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function DriverEarnings() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, loading, error, refreshing, refresh, reload } =
    useApi<EarningsResponse>('/api/mobile/driver/earnings');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const unpaid = (data?.earnings ?? [])
    .filter((item) => item.status === 'ACCRUED' && item.payoutStatus === 'UNPAID')
    .reduce((sum, item) => sum + item.netKobo, 0);

  const requestPayout = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await api('/api/mobile/driver', { method: 'POST', body: { action: 'payout' } });
      await refresh();
      Alert.alert('Payout requested', 'Your transfer has been submitted to Flutterwave.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not request a payout.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <LoadingView label="Loading earnings…" />
      </View>
    );
  }

  const bank = data?.bankAccount;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <Card style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.small, color: colors.textMuted }}>Available to request</Text>
        <Text style={{ ...typography.title, color: colors.text }}>{kobo(unpaid)}</Text>
        <Text style={{ ...typography.small, color: colors.textFaint }}>
          Your share after the university commission on each completed ride.
        </Text>
        <Button
          title="Request payment"
          onPress={requestPayout}
          loading={busy}
          disabled={unpaid === 0}
          icon="cash-outline"
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Bank account</SectionTitle>
        {bank ? (
          <>
            <Row label={bank.bankName ?? 'Bank'} value={bank.accountNumber ?? '—'} />
            <Row label="Account name" value={bank.accountName ?? '—'} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Badge
                label={bank.verified ? 'Verified' : 'Not verified'}
                tone={bank.verified ? 'success' : 'warning'}
              />
              {!bank.verified ? (
                <Text style={{ ...typography.small, color: colors.textMuted, flex: 1 }}>
                  Re-save your details to confirm the account name.
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <Text style={{ ...typography.small, color: colors.textMuted }}>
            Add your bank details to receive driver payments.
          </Text>
        )}
        <Button
          title={bank ? 'Update bank details' : 'Add bank details'}
          variant="secondary"
          onPress={() => router.push('/(driver)/bank')}
          icon="business-outline"
        />
      </Card>

      <View style={{ gap: spacing.sm }}>
        <SectionTitle>Completed rides</SectionTitle>
        {data && data.earnings.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="No earnings yet"
            message="Complete a paid ride and your earnings will show up here."
          />
        ) : null}
        {(data?.earnings ?? []).map((item) => (
          <Card key={item.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ ...typography.bodyStrong, color: colors.text, flex: 1 }} numberOfLines={1}>
                {item.route}
              </Text>
              <Text style={{ ...typography.bodyStrong, color: colors.text }}>{kobo(item.netKobo)}</Text>
            </View>
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              Fare {kobo(item.grossKobo)} · commission −{kobo(item.commissionKobo)}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ ...typography.small, color: colors.textFaint }}>{shortDate(item.date)}</Text>
              <Badge
                label={item.payoutStatus === 'PAID' ? 'Paid out' : 'Unpaid'}
                tone={item.payoutStatus === 'PAID' ? 'success' : 'warning'}
              />
            </View>
          </Card>
        ))}
      </View>

      {(data?.payouts.length ?? 0) > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>Payout history</SectionTitle>
          {(data?.payouts ?? []).map((payout) => (
            <Card key={payout.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ ...typography.bodyStrong, color: colors.text }}>₦{payout.amount.toLocaleString('en-NG')}</Text>
                <Badge
                  label={payout.status}
                  tone={
                    payout.status === 'SUCCESS'
                      ? 'success'
                      : payout.status === 'FAILED'
                        ? 'danger'
                        : 'warning'
                  }
                />
              </View>
              <Text style={{ ...typography.small, color: colors.textFaint }}>
                {dateTime(payout.createdAt)}
              </Text>
              {payout.failureReason ? (
                <Text style={{ ...typography.small, color: colors.danger }}>{payout.failureReason}</Text>
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          alignItems: 'center',
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
        <Text style={{ ...typography.small, color: colors.textMuted, flex: 1 }}>
          Payouts are sent straight to your verified bank account. The commission is settled with
          your university separately.
        </Text>
      </View>

      <View style={{ height: StyleSheet.hairlineWidth }} />
    </Screen>
  );
}
