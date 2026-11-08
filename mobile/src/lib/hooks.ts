import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { ApiError, api } from '@/lib/api';

/**
 * Fetch a GET endpoint, reload when the screen regains focus, and expose
 * loading/error state for inline messages. Screens never render mock data: an
 * unreachable API shows an error, not a fake ride.
 */
export function useApi<T>(path: string | null, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path) && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!path || !enabled) {
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      try {
        const result = await api<T>(path);
        if (!mounted.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      } finally {
        if (!mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path, enabled]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      // Silent refresh on focus keeps ride state current without a spinner.
      if (data) load('refresh');
    }, [load, data])
  );

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => load('initial'),
    refresh: () => load('refresh'),
    setData,
  };
}

/** Live network state, used for the offline banner and offline guards. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  return online;
}

/** Poll an async function until it reports done, or the attempt budget runs out. */
export async function poll<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  { attempts = 8, delayMs = 2500 }: { attempts?: number; delayMs?: number } = {}
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await fn();
      if (isDone(value)) return value;
    } catch {
      // Transient errors are expected while the payment settles.
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
