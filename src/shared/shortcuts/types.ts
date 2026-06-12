import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

import type { ShortcutBinding } from './tokens'

/** Preference keys under the `shortcut.` namespace (one per command). */
export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

/** Runtime-resolved shortcut state after merging user preferences with command defaults. */
export interface ResolvedShortcut {
  /** Effective key binding used at runtime. User-defined, default, or empty (explicitly cleared). */
  binding: ShortcutBinding
  /** Whether this shortcut is currently enabled. */
  enabled: boolean
}
