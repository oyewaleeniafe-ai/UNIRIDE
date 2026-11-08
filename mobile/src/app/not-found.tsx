import { useRouter } from 'expo-router';
import { EmptyState, Button, Screen } from '@/components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen scroll={false} style={{ flex: 1, justifyContent: 'center' }}>
      <EmptyState
        icon="compass-outline"
        title="Screen not found"
        message="That link does not lead anywhere in the app."
        action={<Button title="Go home" onPress={() => router.replace('/')} />}
      />
    </Screen>
  );
}
