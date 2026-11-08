import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Redirect } from '@/components/redirect';

/**
 * Entry gate: sends a restored session to the right home, and everyone else to
 * sign-in. Roles come from the server profile, never from local state.
 */
export default function Index() {
  const { status, me } = useAuth();
  const { colors } = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (status === 'signedOut' || !me) return <Redirect href="/(auth)/login" />;

  if (me.user.role === 'DRIVER') return <Redirect href="/(driver)" />;
  if (me.user.role === 'ADMIN') return <Redirect href="/(student)" />;
  return <Redirect href="/(student)" />;
}
