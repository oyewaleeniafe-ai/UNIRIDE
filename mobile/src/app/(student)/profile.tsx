import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, Row, Screen, SectionTitle, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ApiError, api } from '@/lib/api';
import { initials } from '@/lib/format';
import type { Me } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function StudentProfile() {
  const { me, refresh, signOut } = useAuth();
  const router = useRouter();
  const { colors, preference, setPreference } = useTheme();

  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [name, setName] = useState(me?.user.name ?? '');
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    setError(null);
    setBusy(true);
    try {
      await api<{ user: Me['user'] }>('/api/mobile/me', { method: 'PATCH', body: { name, phone } });
      await refresh();
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/api/mobile/me', { method: 'POST', body: { currentPassword, newPassword } });
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert('Password updated', 'Use your new password the next time you sign in.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to book a ride.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  if (!me) return <Screen />;

  return (
    <Screen>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...typography.h2, color: colors.primary }}>{initials(me.user.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h2, color: colors.text }}>{me.user.name}</Text>
          <Text style={{ ...typography.small, color: colors.textMuted }}>{me.user.email}</Text>
          <Text style={{ ...typography.small, color: colors.textFaint }}>{me.user.phone}</Text>
        </View>
        <Pressable
          onPress={() => {
            setName(me.user.name);
            setPhone(me.user.phone);
            setError(null);
            setEditOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          hitSlop={10}
        >
          <Ionicons name="create-outline" size={22} color={colors.primary} />
        </Pressable>
      </Card>

      {me.student ? (
        <Card>
          <SectionTitle>Student details</SectionTitle>
          <Row label="Matric number" value={me.student.matricNo} />
          <Row label="University" value={me.student.university} />
        </Card>
      ) : null}

      <Card style={{ padding: 0 }}>
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            padding: spacing.lg,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          })}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>Notifications</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Appearance</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {(['system', 'light', 'dark'] as const).map((option) => {
            const selected = preference === option;
            return (
              <Pressable
                key={option}
                onPress={() => setPreference(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                  alignItems: 'center',
                  backgroundColor: colors.surfaceAlt,
                }}
              >
                <Text style={{ ...typography.smallStrong, color: colors.text, textTransform: 'capitalize' }}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ padding: 0 }}>
        <Pressable
          onPress={() => {
            setError(null);
            setPasswordOpen(true);
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            padding: spacing.lg,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          })}
        >
          <Ionicons name="lock-closed-outline" size={20} color={colors.text} />
          <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>Change password</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>
      </Card>

      <Button title="Sign out" variant="danger" onPress={confirmSignOut} icon="log-out-outline" />

      <Text style={{ ...typography.small, color: colors.textFaint, textAlign: 'center' }}>
        CampusCab · v1.0.0
      </Text>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
            <Text style={{ ...typography.h2, color: colors.text }}>Edit profile</Text>
            {error ? <ErrorBanner message={error} /> : null}
            <TextField label="Name" value={name} onChangeText={setName} />
            <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Button title="Save" onPress={saveProfile} loading={busy} />
            <Button title="Cancel" variant="ghost" onPress={() => setEditOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={passwordOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPasswordOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
            <Text style={{ ...typography.h2, color: colors.text }}>Change password</Text>
            {error ? <ErrorBanner message={error} /> : null}
            <TextField
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secure
            />
            <TextField
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secure
              hint="At least 8 characters"
            />
            <Button title="Update password" onPress={changePassword} loading={busy} />
            <Button title="Cancel" variant="ghost" onPress={() => setPasswordOpen(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
