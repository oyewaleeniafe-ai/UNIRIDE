import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ErrorBanner, TextField } from '@/components/ui';
import { HintPicker } from '@/components/hint-picker';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { spacing, typography, useTheme } from '@/lib/theme';

export default function RegisterStudentScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();

  const [form, setForm] = useState({
    name: '',
    email: '',
    matricNo: '',
    phone: '',
    password: '',
    confirmPassword: '',
    hintQuestion: '',
    hintAnswer: '',
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
      await register({ ...form, email: form.email.trim(), role: 'STUDENT' });
      router.replace('/(student)');
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
        <Text style={{ ...typography.h2, color: colors.text }}>Create your student account</Text>
        <Text style={{ ...typography.small, color: colors.textMuted, marginTop: -spacing.sm }}>
          Use the email and matric number you registered at your university.
        </Text>

        {error ? <ErrorBanner message={error} /> : null}

        <TextField label="Full name" value={form.name} onChangeText={set('name')} placeholder="Ada Okafor" autoComplete="name" />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={set('email')}
          placeholder="you@university.edu.ng"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Matric number"
          value={form.matricNo}
          onChangeText={set('matricNo')}
          placeholder="e.g. CSC/2024/001"
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

        <Button title="Create account" onPress={submit} loading={busy} />

        <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ alignSelf: 'center' }}>
          <Text style={{ ...typography.smallStrong, color: colors.primary }}>I already have an account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
