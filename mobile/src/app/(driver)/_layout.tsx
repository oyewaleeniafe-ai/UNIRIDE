import { Tabs, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OfflineBanner } from '@/components/offline-banner';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Redirect } from '@/components/redirect';

export default function DriverLayout() {
  const { status, me } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  if (status === 'loading') return null;
  if (status === 'signedOut' || !me) return <Redirect href="/(auth)/login" />;
  if (me.user.role !== 'DRIVER') return <Redirect href="/(student)" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/notifications')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={{ marginRight: 16 }}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.text} />
            </Pressable>
          ),
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            headerTitle: 'CampusCab Driver',
            tabBarIcon: ({ color, size }) => <Ionicons name="speedometer-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="requests"
          options={{
            title: 'Requests',
            tabBarIcon: ({ color, size }) => <Ionicons name="mail-unread-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="earnings"
          options={{
            title: 'Earnings',
            tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen name="inspection" options={{ href: null }} />
        <Tabs.Screen name="bank" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
