import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutBinding } from '@shared/utils/shortcut'

/** Preference keys under the `shortcut.` namespace (one per command). */
export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

export type ShortcutRegistrationConflictReason = 'occupied' | 'wayland'

export type ShortcutRegistrationConflictPayload =
  | { key: ShortcutPreferenceKey; accelerator: string; hasConflict: true; reason: ShortcutRegistrationConflictReason }
  | { key: ShortcutPreferenceKey; hasConflict: false; reason?: never }

/** Runtime-resolved shortcut state after merging user preferences with command defaults. */
export interface ResolvedShortcut {
  /** Effective key binding used at runtime. User-defined, default, or empty (explicitly cleared). */
  binding: ShortcutBinding
  /** Whether this shortcut is currently enabled. */
  enabled: boolean
}
