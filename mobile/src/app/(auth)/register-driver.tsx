import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ErrorBanner, TextField } from '@/components/ui';
import { HintPicker } from '@/components/hint-picker';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { spacing, typography, useTheme } from '@/lib/theme';

export default function RegisterDriverScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();

  const [form, setForm] = useState({
    name: '',
    email: '',
    driverId: '',
    phone: '',
    password: '',
    confirmPassword: '',
    hintQuestion: '',
    hintAnswer: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    licensePlate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setError(null);
    if (!form.hintQuestion) {
      setError('Choose a security question so you can recover your account.');
      return;
    }
    setBusy(true);
    try {
      await register({ ...form, email: form.email.trim(), role: 'DRIVER' });
      router.replace('/(driver)');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...typography.h2, color: colors.text }}>Become a CampusCab driver</Text>
        <Text style={{ ...typography.small, color: colors.textMuted, marginTop: -spacing.sm }}>
          After signing up you will complete a vehicle inspection before you can go online.
        </Text>

        {error ? <ErrorBanner message={error} /> : null}

        <TextField label="Full name" value={form.name} onChangeText={set('name')} placeholder="Chinedu Eze" autoComplete="name" />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={set('email')}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Driver ID"
          value={form.driverId}
          onChangeText={set('driverId')}
          placeholder="e.g. DRV-1042"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <TextField
          label="Phone number"
          value={form.phone}
          onChangeText={set('phone')}
          placeholder="08012345678"
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <TextField
          label="Password"
          value={form.password}
          onChangeText={set('password')}
          placeholder="At least 8 characters"
          secure
          autoComplete="new-password"
        />
        <TextField
          label="Confirm password"
          value={form.confirmPassword}
          onChangeText={set('confirmPassword')}
          placeholder="Re-enter your password"
          secure
          autoComplete="new-password"
        />

        <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.sm }}>Your vehicle</Text>
        <TextField label="Make" value={form.vehicleMake} onChangeText={set('vehicleMake')} placeholder="Toyota" />
        <TextField label="Model" value={form.vehicleModel} onChangeText={set('vehicleModel')} placeholder="Corolla" />
        <TextField label="Colour" value={form.vehicleColor} onChangeText={set('vehicleColor')} placeholder="Silver" />
        <TextField
          label="Licence plate"
          value={form.licensePlate}
          onChangeText={set('licensePlate')}
          placeholder="ABC-123XY"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <View style={{ gap: spacing.md }}>
          <HintPicker value={form.hintQuestion} onChange={set('hintQuestion')} />
          <TextField
            label="Security answer"
            value={form.hintAnswer}
            onChangeText={set('hintAnswer')}
            placeholder="Your answer"
            autoCapitalize="none"
          />
        </View>

        <Button title="Create driver account" onPress={submit} loading={busy} />

        <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ alignSelf: 'center' }}>
          <Text style={{ ...typography.smallStrong, color: colors.primary }}>I already have an account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
