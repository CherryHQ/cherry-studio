import { COMMAND_DEFINITIONS } from '@shared/utils/command'

import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/shortcut'

/**
 * Generated from the shared command registry (single source of truth): every
 * editable keybinding row is searchable by its command title key. anchorId
 * mirrors the row id: command ids are dot/underscore-separated, dom ids dash
 * them. Breadcrumb groups mirror useCommandShortcuts' grouping: general/chat/
 * topic by categoryKey, everything else (incl. feature.*) falls to assistant.
 */
const categoryToBreadcrumbKey = (categoryKey: string): string => {
  const known = categoryKey.replace(/^settings\.shortcuts\./, 'settings.shortcuts.categories.')
  return /^(settings\.shortcuts\.categories\.(general|chat|topic))$/.test(known)
    ? known
    : 'settings.shortcuts.categories.assistant'
}

export const entries: SettingsSearchEntry[] = COMMAND_DEFINITIONS.filter(
  (definition) => definition.keybinding && definition.keybinding.editable !== false
).map((definition) => ({
  anchorId: definition.id.replace(/[._]/g, '-'),
  titleKey: definition.titleKey,
  groupKey: categoryToBreadcrumbKey(definition.categoryKey)
}))
