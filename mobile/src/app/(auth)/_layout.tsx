import { Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Redirect } from '@/components/redirect';

export default function AuthLayout() {
  const { status, me } = useAuth();
  const { colors } = useTheme();

  if (status === 'signedIn' && me) {
    return <Redirect href={me.user.role === 'DRIVER' ? '/(driver)' : '/(student)'} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false, title: 'Sign in' }} />
      <Stack.Screen name="register-student" options={{ title: 'Student sign up' }} />
      <Stack.Screen name="register-driver" options={{ title: 'Driver sign up' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
    </Stack>
  );
}
