import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, ErrorBanner, Screen, TextField } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { EarningsResponse } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

type Bank = { code: string; name: string };

export default function BankDetailsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const banks = useApi<{ banks: Bank[] }>('/api/mobile/banks');
  const current = useApi<EarningsResponse>('/api/mobile/driver/earnings');

  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState(current.data?.bankAccount?.accountName ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = (banks.data?.banks ?? []).filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const save = async () => {
    setError(null);
    if (!bank) {
      setError('Select your bank.');
      return;
    }
    if (!/^\d{10}$/.test(accountNumber.trim())) {
      setError('Account number must be 10 digits.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ bankAccount: { verified: boolean; accountName: string } }>(
        '/api/mobile/driver',
        {
          method: 'POST',
          body: {
            action: 'bank',
            bankCode: bank.code,
            accountNumber: accountNumber.trim(),
            accountName: accountName.trim(),
          },
        }
      );
      await current.refresh();
      Alert.alert(
        result.bankAccount.verified ? 'Account verified' : 'Details saved',
        result.bankAccount.verified
          ? `We confirmed this account belongs to ${result.bankAccount.accountName}.`
          : 'We could not reach the verification service just now, so the account is saved as pending. Re-save it later to verify.',
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your bank details.');
    } finally {
      setBusy(false);
    }
  };

  const existing = current.data?.bankAccount;

  return (
    <Screen>
      <Text style={{ ...typography.h2, color: colors.text }}>Payout bank account</Text>
      <Text style={{ ...typography.small, color: colors.textMuted }}>
        Driver earnings are paid into this account. The account name is confirmed with Flutterwave
        when you save.
      </Text>

      {existing ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.smallStrong, color: colors.textMuted }}>Current account</Text>
          <Text style={{ ...typography.bodyStrong, color: colors.text }}>
            {existing.bankName} · {existing.accountNumber}
          </Text>
          <Text style={{ ...typography.small, color: colors.textMuted }}>{existing.accountName}</Text>
          <Badge
            label={existing.verified ? 'Verified' : 'Pending verification'}
            tone={existing.verified ? 'success' : 'warning'}
          />
        </Card>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {banks.error ? <ErrorBanner message={banks.error} onRetry={banks.reload} /> : null}

      <View style={{ gap: 6 }}>
        <Text style={{ ...typography.smallStrong, color: colors.textMuted }}>Bank</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: 48,
          }}
        >
          <Text style={{ flex: 1, color: bank ? colors.text : colors.textFaint, fontSize: 15 }}>
            {bank?.name ?? existing?.bankName ?? 'Choose your bank'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
        </Pressable>
      </View>

      <TextField
        label="Account number"
        value={accountNumber}
        onChangeText={setAccountNumber}
        keyboardType="number-pad"
        maxLength={10}
        placeholder="0123456789"
      />
      <TextField
        label="Account name"
        value={accountName}
        onChangeText={setAccountName}
        placeholder="Name on the account"
        hint="Flutterwave will confirm this name against the account number."
      />

      <Button title="Save bank details" onPress={save} loading={busy} />

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: spacing.xxl }}>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...typography.h2, color: colors.text }}>Select bank</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={10} accessibilityRole="button">
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                paddingHorizontal: spacing.md,
              }}
            >
              <Ionicons name="search-outline" size={18} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search banks"
                placeholderTextColor={colors.textFaint}
                style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 15 }}
                autoCorrect={false}
              />
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 0 }}>
            {filtered.map((item, index) => (
              <Pressable
                key={item.code}
                onPress={() => {
                  setBank(item);
                  setPickerOpen(false);
                  setQuery('');
                }}
                accessibilityRole="button"
                style={{
                  paddingVertical: spacing.md,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                }}
              >
                <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>{item.name}</Text>
                {bank?.code === item.code ? (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}
