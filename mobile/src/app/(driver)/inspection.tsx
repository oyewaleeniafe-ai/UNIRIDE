import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, CheckRow, ErrorBanner, Screen, SectionTitle } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { DriverSummary } from '@/lib/types';
import { shortDate } from '@/lib/format';
import { spacing, typography, useTheme } from '@/lib/theme';

const ITEMS: Array<{ key: keyof Checklist; label: string; description: string }> = [
  { key: 'brakes', label: 'Brakes', description: 'Brakes respond firmly with no unusual noise.' },
  { key: 'tires', label: 'Tyres', description: 'Tread and pressure are safe, including the spare.' },
  { key: 'lights', label: 'Lights', description: 'Headlights, indicators and brake lights work.' },
  { key: 'interiorClean', label: 'Clean interior', description: 'Seats and cabin are clean for passengers.' },
  { key: 'noTrash', label: 'No trash', description: 'No litter or clutter left in the vehicle.' },
  { key: 'fireExtinguisher', label: 'Fire extinguisher', description: 'Present and within its service date.' },
  { key: 'firstAidKit', label: 'First aid kit', description: 'Kit is present and stocked.' },
  { key: 'fuelBattery', label: 'Fuel or battery above 50%', description: 'Enough range for today’s rides.' },
];

type Checklist = {
  brakes: boolean;
  tires: boolean;
  lights: boolean;
  interiorClean: boolean;
  noTrash: boolean;
  fireExtinguisher: boolean;
  firstAidKit: boolean;
  fuelBattery: boolean;
};

const EMPTY: Checklist = {
  brakes: false,
  tires: false,
  lights: false,
  interiorClean: false,
  noTrash: false,
  fireExtinguisher: false,
  firstAidKit: false,
  fuelBattery: false,
};

export default function InspectionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, reload } = useApi<DriverSummary>('/api/mobile/driver');

  const [checked, setChecked] = useState<Checklist>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allPassed = Object.values(checked).every(Boolean);

  const toggle = (key: keyof Checklist) =>
    setChecked((current) => ({ ...current, [key]: !current[key] }));

  const submit = async () => {
    if (!allPassed) {
      setError('Every item must pass before you can go online.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/mobile/driver', { method: 'POST', body: { action: 'inspection', ...checked } });
      await reload();
      Alert.alert(
        'Inspection passed',
        'Your vehicle inspection is recorded. You can now go online and accept rides.',
        [{ text: 'Continue', onPress: () => router.back() }]
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the inspection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={{ ...typography.h2, color: colors.text }}>Vehicle inspection</Text>
      <Text style={{ ...typography.small, color: colors.textMuted }}>
        Answer honestly. The server only marks this inspection complete when every item passes, and
        you cannot go online without it.
      </Text>

      {data?.inspection ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>Last submission</SectionTitle>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Badge
              label={data.inspection.status === 'COMPLETED' ? 'Passed' : 'Incomplete'}
              tone={data.inspection.status === 'COMPLETED' ? 'success' : 'warning'}
            />
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              {shortDate(data.inspection.createdAt)}
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      <Card style={{ paddingVertical: 0 }}>
        {ITEMS.map((item) => (
          <CheckRow
            key={item.key}
            label={item.label}
            description={item.description}
            checked={checked[item.key]}
            onToggle={() => toggle(item.key)}
          />
        ))}
      </Card>

      <Text style={{ ...typography.small, color: allPassed ? colors.success : colors.textMuted }}>
        {Object.values(checked).filter(Boolean).length} of 8 checks passed
      </Text>

      <Button title="Submit inspection" onPress={submit} loading={busy} disabled={!allPassed} />
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
