import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { ApiError, api, setTokenReader } from '@/lib/api';
import type { Me } from '@/lib/types';
import { registerForPushNotifications, unregisterPushToken } from '@/lib/push';

const TOKEN_KEY = 'campuscab.session.token';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  token: string | null;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (payload: Record<string, unknown> & { role: 'STUDENT' | 'DRIVER' }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<Me | null>;
  applyToken: (token: string) => Promise<Me | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const pushToken = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // The API client reads the token through this getter, so it always sends the
  // current session without any module-level duplication.
  useEffect(() => {
    setTokenReader(() => tokenRef.current);
  }, []);

  const persist = useCallback(async (next: string | null) => {
    tokenRef.current = next;
    setToken(next);
    if (next) await SecureStore.setItemAsync(TOKEN_KEY, next, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const loadMe = useCallback(async () => {
    const profile = await api<Me>('/api/mobile/me');
    setMe(profile);
    return profile;
  }, []);

  // Restore a saved session on launch. A 401 means the session is dead, so the
  // token is discarded rather than retried forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!saved) {
          if (!cancelled) setStatus('signedOut');
          return;
        }
        tokenRef.current = saved;
        setToken(saved);
        await loadMe();
        if (!cancelled) setStatus('signedIn');
        registerForPushNotifications()
          .then((value) => {
            pushToken.current = value;
          })
          .catch(() => {});
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await persist(null);
          setMe(null);
          setStatus('signedOut');
        } else {
          // Offline launch: keep the token and let screens retry.
          setStatus('signedIn');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe, persist]);

  const applyToken = useCallback(
    async (next: string) => {
      await persist(next);
      const profile = await loadMe();
      setStatus('signedIn');
      registerForPushNotifications()
        .then((value) => {
          pushToken.current = value;
        })
        .catch(() => {});
      return profile;
    },
    [loadMe, persist]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api<{ token: string }>('/api/mobile/auth/login', {
        method: 'POST',
        anonymous: true,
        body: { email: email.trim(), password },
      });
      await applyToken(result.token);
    },
    [applyToken]
  );

  const register = useCallback(
    async (payload: Record<string, unknown> & { role: 'STUDENT' | 'DRIVER' }) => {
      const result = await api<{ token: string }>('/api/mobile/auth/register', {
        method: 'POST',
        anonymous: true,
        body: payload,
      });
      await applyToken(result.token);
    },
    [applyToken]
  );

  const signOut = useCallback(async () => {
    await unregisterPushToken(pushToken.current);
    pushToken.current = null;
    await persist(null);
    setMe(null);
    setStatus('signedOut');
  }, [persist]);

  const refresh = useCallback(async () => {
    try {
      return await loadMe();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await persist(null);
        setMe(null);
        setStatus('signedOut');
      }
      return null;
    }
  }, [loadMe, persist]);

  const value = useMemo(
    () => ({ status, token, me, signIn, register, signOut, refresh, applyToken }),
    [status, token, me, signIn, register, signOut, refresh, applyToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
