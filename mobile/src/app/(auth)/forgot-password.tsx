import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ErrorBanner, TextField } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { spacing, typography, useTheme } from '@/lib/theme';

type Step = 'identify' | 'verify' | 'reset';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [step, setStep] = useState<Step>('identify');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const identify = () =>
    run(async () => {
      const result = await api<{ hintQuestion: string }>('/api/mobile/auth/recover', {
        method: 'POST',
        anonymous: true,
        body: { step: 'identify', email: email.trim() },
      });
      setQuestion(result.hintQuestion);
      setStep('verify');
    });

  const verify = () =>
    run(async () => {
      const result = await api<{ resetToken: string }>('/api/mobile/auth/recover', {
        method: 'POST',
        anonymous: true,
        body: { step: 'verify', email: email.trim(), hintAnswer: answer },
      });
      setResetToken(result.resetToken);
      setStep('reset');
    });

  const reset = () =>
    run(async () => {
      await api('/api/mobile/auth/recover', {
        method: 'POST',
        anonymous: true,
        body: { step: 'reset', resetToken, password, confirmPassword },
      });
      router.replace('/(auth)/login');
    });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...typography.h2, color: colors.text }}>
          {step === 'identify' ? 'Find your account' : step === 'verify' ? 'Answer your question' : 'Set a new password'}
        </Text>
        <Text style={{ ...typography.small, color: colors.textMuted, marginTop: -spacing.sm }}>
          {step === 'identify'
            ? 'Enter the email you signed up with.'
            : step === 'verify'
              ? question
              : 'Choose a password of at least 8 characters.'}
        </Text>

        {error ? <ErrorBanner message={error} /> : null}

        {step === 'identify' ? (
          <>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@university.edu.ng"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title="Continue" onPress={identify} loading={busy} />
          </>
        ) : null}

        {step === 'verify' ? (
          <>
            <TextField label="Your answer" value={answer} onChangeText={setAnswer} autoCapitalize="none" />
            <Button title="Verify" onPress={verify} loading={busy} />
          </>
        ) : null}

        {step === 'reset' ? (
          <>
            <TextField label="New password" value={password} onChangeText={setPassword} secure />
            <TextField
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secure
            />
            <Button title="Change password" onPress={reset} loading={busy} />
          </>
        ) : null}

        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
