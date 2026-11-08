import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function Screen({
  children = null,
  scroll = true,
  padded = true,
  refreshControl,
  style,
}: {
  children?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: React.ReactElement;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[padded && { padding: spacing.lg }, { gap: spacing.lg }, style]}>{children}</View>
  );

  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{content}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {content}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: 'transparent' },
    secondary: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: 'transparent' },
  }[variant];

  const heights = { sm: 38, md: 48, lg: 54 }[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        {
          height: heights,
          borderRadius: radius.md,
          backgroundColor: palette.bg,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
          <Text
            style={{
              color: palette.fg,
              fontSize: size === 'sm' ? 14 : 16,
              fontWeight: '600',
            }}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  hint,
  secure = false,
  ...props
}: TextInputProps & { label: string; error?: string | null; hint?: string; secure?: boolean }) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(secure);

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...typography.smallStrong, color: colors.textMuted }}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? colors.danger : colors.border,
          paddingHorizontal: spacing.md,
        }}
      >
        <TextInput
          {...props}
          secureTextEntry={hidden}
          placeholderTextColor={colors.textFaint}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 16,
            paddingVertical: 13,
          }}
          accessibilityLabel={label}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={{ ...typography.small, color: colors.danger }}>{error}</Text>
      ) : hint ? (
        <Text style={{ ...typography.small, color: colors.textFaint }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
}) {
  const { colors } = useTheme();
  const map = {
    neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    primary: { bg: colors.primarySoft, fg: colors.primary },
  }[tone];

  return (
    <View
      style={{
        backgroundColor: map.bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ ...typography.tiny, color: map.fg, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ ...typography.h3, color: colors.text }}>{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={24} color={colors.textFaint} />
      </View>
      <Text style={{ ...typography.h3, color: colors.text, textAlign: 'center' }}>{title}</Text>
      <Text
        style={{
          ...typography.small,
          color: colors.textMuted,
          textAlign: 'center',
          maxWidth: 280,
          lineHeight: 19,
        }}
      >
        {message}
      </Text>
      {action ? <View style={{ marginTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.dangerSoft,
        borderRadius: radius.md,
        padding: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <Text style={{ ...typography.small, color: colors.danger, flex: 1 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={{ ...typography.smallStrong, color: colors.danger }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.sm }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ ...typography.small, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

export function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ ...typography.small, color: colors.textMuted }}>{label}</Text>
      <Text
        style={{
          ...(strong ? typography.bodyStrong : typography.small),
          color: strong ? colors.text : colors.textMuted,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function Stepper({
  value,
  min = 1,
  max = 10,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}) {
  const { colors } = useTheme();
  const disabledStyle = { opacity: 0.4 };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel="Remove a passenger"
        style={[
          {
            width: 38,
            height: 38,
            borderRadius: radius.pill,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          },
          value <= min && disabledStyle,
        ]}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={{ ...typography.h2, color: colors.text, minWidth: 24, textAlign: 'center' }}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel="Add a passenger"
        style={[
          {
            width: 38,
            height: 38,
            borderRadius: radius.pill,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          },
          value >= max && disabledStyle,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

export function CheckRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: checked ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: colors.textFaint,
          backgroundColor: checked ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...typography.bodyStrong, color: colors.text }}>{label}</Text>
        {description ? (
          <Text style={{ ...typography.small, color: colors.textMuted }}>{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}
