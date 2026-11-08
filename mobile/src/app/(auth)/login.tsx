import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, ErrorBanner, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
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
        contentContainerStyle={{
          flexGrow: 1,
          padding: spacing.xl,
          paddingTop: insets.top + spacing.xxl,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.sm }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.lg,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="car" size={28} color={colors.onPrimary} />
          </View>
          <Text style={{ ...typography.title, color: colors.text, marginTop: spacing.md }}>
            Welcome to CampusCab
          </Text>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            Sign in to book a ride or start accepting rides.
          </Text>
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        <View style={{ gap: spacing.lg }}>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@university.edu.ng"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secure
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <Button title="Sign in" onPress={submit} loading={busy} />

          <Pressable
            onPress={() => router.push('/(auth)/forgot-password')}
            accessibilityRole="button"
            style={{ alignSelf: 'center' }}
          >
            <Text style={{ ...typography.smallStrong, color: colors.primary }}>Forgot your password?</Text>
          </Pressable>
        </View>

        <View style={{ gap: spacing.md, marginTop: 'auto' }}>
          <Text style={{ ...typography.small, color: colors.textFaint, textAlign: 'center' }}>
            New to CampusCab?
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Pressable
                onPress={() => router.push('/(auth)/register-student')}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ ...typography.smallStrong, color: colors.text }}>Student sign up</Text>
              </Pressable>
            <Pressable
                onPress={() => router.push('/(auth)/register-driver')}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ ...typography.smallStrong, color: colors.text }}>Driver sign up</Text>
              </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
