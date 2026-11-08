import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { spacing, typography, useTheme } from '@/lib/theme';

/**
 * Deep-link landing for `campuscab://payment`.
 *
 * Flutterwave sends the browser here after checkout (via the server redirect).
 * The status shown is whatever the server just verified with Flutterwave — the
 * query string alone is never trusted, and the app never marks a ride paid.
 */
export default function PaymentResultScreen() {
  const { status: paramStatus, reference } = useLocalSearchParams<{
    status?: string;
    reference?: string;
  }>();
  const router = useRouter();
  const { me } = useAuth();
  const { colors } = useTheme();

  const [status, setStatus] = useState<'checking' | 'successful' | 'pending' | 'failed' | 'unknown'>(
    'checking'
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!reference) {
        setStatus(paramStatus === 'successful' ? 'successful' : 'unknown');
        return;
      }
      try {
        const result = await api<{ status: string }>('/api/mobile/payments', {
          method: 'POST',
          body: { action: 'verify', reference },
        });
        if (!cancelled) {
          setStatus(
            result.status === 'successful'
              ? 'successful'
              : result.status === 'failed'
                ? 'failed'
                : 'pending'
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not confirm the payment.');
          setStatus('pending');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reference, paramStatus]);

  const homeHref = me?.user.role === 'DRIVER' ? '/(driver)' : '/(student)';

  return (
    <Screen scroll={false} style={{ justifyContent: 'center', flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Card style={{ alignItems: 'center', gap: spacing.md }}>
        {status === 'checking' ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ ...typography.h3, color: colors.text }}>Confirming your payment…</Text>
            <Text style={{ ...typography.small, color: colors.textMuted, textAlign: 'center' }}>
              Please keep this screen open for a moment.
            </Text>
          </>
        ) : (
          <>
            <Ionicons
              name={
                status === 'successful'
                  ? 'checkmark-circle'
                  : status === 'failed'
                    ? 'close-circle'
                    : 'time'
              }
              size={44}
              color={
                status === 'successful' ? colors.success : status === 'failed' ? colors.danger : colors.warning
              }
            />
            <Text style={{ ...typography.h2, color: colors.text, textAlign: 'center' }}>
              {status === 'successful'
                ? 'Payment confirmed'
                : status === 'failed'
                  ? 'Payment failed'
                  : 'Payment pending'}
            </Text>
            <Text style={{ ...typography.small, color: colors.textMuted, textAlign: 'center' }}>
              {status === 'successful'
                ? 'Your ride is paid for and drivers can now accept it.'
                : status === 'failed'
                  ? 'No money was taken. Open the ride to try paying again.'
                  : 'We have not received confirmation from Flutterwave yet. Open your rides in a moment to check again.'}
            </Text>
            {error ? (
              <Text style={{ ...typography.small, color: colors.danger, textAlign: 'center' }}>{error}</Text>
            ) : null}
          </>
        )}

        <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button title="Go to my rides" onPress={() => router.replace('/(student)/rides')} />
          <Button title="Back to home" variant="ghost" onPress={() => router.replace(homeHref)} />
        </View>
      </Card>
    </Screen>
  );
}
