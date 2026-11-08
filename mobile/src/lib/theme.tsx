import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * CampusCab palette.
 *
 * Mirrors the website's design tokens (indigo primary, lavender-tinted
 * surfaces) so the app and site read as one product. Deliberately flat:
 * hairline borders and one surface tint instead of gradients or glass.
 */
export type Scheme = 'light' | 'dark';

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
};

const light: Palette = {
  background: '#f2f2fb',
  surface: '#ffffff',
  surfaceAlt: '#f4f4fb',
  border: '#e5e6f2',
  text: '#17181f',
  textMuted: '#5d6376',
  textFaint: '#8b90a0',
  primary: '#4338ca',
  primaryPressed: '#372fae',
  onPrimary: '#ffffff',
  primarySoft: 'rgba(67, 56, 202, 0.09)',
  danger: '#d92d43',
  dangerSoft: 'rgba(217, 45, 67, 0.1)',
  success: '#12813f',
  successSoft: 'rgba(18, 129, 63, 0.1)',
  warning: '#a25b00',
  warningSoft: 'rgba(245, 158, 11, 0.14)',
};

const dark: Palette = {
  background: '#0d0e15',
  surface: '#161824',
  surfaceAlt: '#1c1f2e',
  border: '#272a3f',
  text: '#e8e9f2',
  textMuted: '#9ba1b5',
  textFaint: '#6d7386',
  primary: '#818cf8',
  primaryPressed: '#a3adfb',
  onPrimary: '#0d0e15',
  primarySoft: 'rgba(129, 140, 248, 0.14)',
  danger: '#e85d6c',
  dangerSoft: 'rgba(232, 93, 108, 0.14)',
  success: '#4cce6a',
  successSoft: 'rgba(76, 206, 106, 0.14)',
  warning: '#fcd34d',
  warningSoft: 'rgba(252, 211, 77, 0.14)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const typography = {
  title: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, fontWeight: '600' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.5 },
};

type ThemePreference = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  scheme: Scheme;
  colors: Palette;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'campuscab.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(
      preference === 'system' ? 'unspecified' : (preference as ColorSchemeName)
    );
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo(
    () => ({ scheme, colors: scheme === 'dark' ? dark : light, preference, setPreference }),
    [scheme, preference, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
