import { platform } from '@renderer/utils/platform'
import type { SupportedPlatform } from '@shared/types/command'
import { COMMAND_DEFINITIONS, isPlatformSupported } from '@shared/utils/command'

import type { SettingsSearchEntry } from './settingsSearch/types'

export const route = '/settings/shortcut'

/** Shared by the row JSX and the index — command ids dash their dots/underscores */
export const shortcutAnchorId = (commandId: string) => commandId.replace(/[._]/g, '-')

/**
 * Generated from the shared command registry (single source of truth): every
 * editable, platform-supported keybinding row is searchable by its command
 * title key. Breadcrumb groups mirror useCommandShortcuts' grouping:
 * general/chat/topic by categoryKey, everything else falls to assistant.
 *
 * Feature-gated commands stay indexed on purpose: their rows render whenever
 * the owning feature is enabled, and a disabled-feature jump degrades to the
 * plain list (silent give-up) per the focus-scroll contract.
 */
const categoryToBreadcrumbKey = (categoryKey: string): string => {
  const known = categoryKey.replace(/^settings\.shortcuts\./, 'settings.shortcuts.categories.')
  return /^(settings\.shortcuts\.categories\.(general|chat|topic))$/.test(known)
    ? known
    : 'settings.shortcuts.categories.assistant'
}

// Command definition literals don't all carry `editable` on their keybinding
type CommandDefinition = (typeof COMMAND_DEFINITIONS)[number]

const currentPlatform = platform as SupportedPlatform | undefined

const isSearchableCommand = (definition: CommandDefinition): boolean => {
  const keybinding = definition.keybinding as
    | { editable?: boolean; supportedPlatforms?: SupportedPlatform[] }
    | undefined
  if (!keybinding || keybinding.editable === false) return false
  // Same filter the shortcut list applies at render time — unsupported
  // platforms would render no row and every jump would silently give up
  return isPlatformSupported(keybinding, currentPlatform)
}

export const entries: SettingsSearchEntry[] = COMMAND_DEFINITIONS.filter(isSearchableCommand).map((definition) => ({
  anchorId: shortcutAnchorId(definition.id),
  titleKey: definition.titleKey,
  groupKey: categoryToBreadcrumbKey(definition.categoryKey)
}))
