import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

/** Same security questions the website offers during registration. */
export const HINT_QUESTIONS = [
  'What is your favorite food?',
  "What is your mother's maiden name?",
  'What city were you born in?',
  'What was the name of your first pet?',
  'What is the name of your best friend?',
  'What was the make of your first car?',
] as const;

export function HintPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...typography.smallStrong, color: colors.textMuted }}>Security question</Text>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: 48,
        }}
      >
        <Text style={{ flex: 1, color: value ? colors.text : colors.textFaint, fontSize: 15 }}>
          {value || 'Choose a question'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </Pressable>

      {open ? (
        <View
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            borderRadius: radius.md,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          }}
        >
          {HINT_QUESTIONS.map((question, index) => (
            <Pressable
              key={question}
              onPress={() => {
                onChange(question);
                setOpen(false);
              }}
              accessibilityRole="button"
              style={{
                padding: spacing.md,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Text style={{ flex: 1, ...typography.small, color: colors.text }}>{question}</Text>
              {value === question ? (
                <Ionicons name="checkmark" size={16} color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
