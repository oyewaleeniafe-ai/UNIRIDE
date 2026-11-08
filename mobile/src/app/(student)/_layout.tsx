import { Tabs, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OfflineBanner } from '@/components/offline-banner';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Redirect } from '@/components/redirect';

export default function StudentLayout() {
  const { status, me } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  if (status === 'loading') return null;
  if (status === 'signedOut' || !me) return <Redirect href="/(auth)/login" />;
  if (me.user.role === 'DRIVER') return <Redirect href="/(driver)" />;

  const headerRight = () => (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      style={{ marginRight: 16 }}
    >
      <Ionicons name="notifications-outline" size={22} color={colors.text} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerRight,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            headerTitle: 'CampusCab',
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="book"
          options={{
            title: 'Book',
            headerTitle: 'Book a ride',
            tabBarIcon: ({ color, size }) => <Ionicons name="car-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="rides"
          options={{
            title: 'My rides',
            headerTitle: 'My rides',
            tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            headerTitle: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color as string} />,
          }}
        />
      </Tabs>
    </View>
  );
}
