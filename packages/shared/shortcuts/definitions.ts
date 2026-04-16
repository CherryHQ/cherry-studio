import type { ShortcutDefinition, ShortcutPreferenceKey } from './types'

const defineShortcut = <const T extends ShortcutDefinition>(definition: T): ShortcutDefinition & T => definition

export const SHORTCUT_DEFINITIONS = [
  // ==================== Application shortcuts ====================
  defineShortcut({
    key: 'shortcut.general.show_main_window',
    scope: 'main',
    category: 'general',
    labelKey: 'show_app',
    global: true
  }),
  defineShortcut({
    key: 'shortcut.general.show_settings',
    scope: 'main',
    category: 'general',
    labelKey: 'show_settings',
    editable: false
  }),
  defineShortcut({
    key: 'shortcut.general.toggle_sidebar',
    scope: 'renderer',
    category: 'general',
    labelKey: 'toggle_sidebar'
  }),
  defineShortcut({
    key: 'shortcut.general.exit_fullscreen',
    scope: 'renderer',
    category: 'general',
    labelKey: 'exit_fullscreen',
    editable: false
  }),
  defineShortcut({
    key: 'shortcut.general.zoom_in',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_in',
    editable: false,
    variants: [['CommandOrControl', 'numadd']]
  }),
  defineShortcut({
    key: 'shortcut.general.zoom_out',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_out',
    editable: false,
    variants: [['CommandOrControl', 'numsub']]
  }),
  defineShortcut({
    key: 'shortcut.general.zoom_reset',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_reset',
    editable: false
  }),
  defineShortcut({
    key: 'shortcut.general.search',
    scope: 'renderer',
    category: 'general',
    labelKey: 'search_message'
  }),
  // ==================== Chat shortcuts ====================
  defineShortcut({
    key: 'shortcut.chat.clear',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'clear_topic'
  }),
  defineShortcut({
    key: 'shortcut.chat.search_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'search_message_in_chat'
  }),
  defineShortcut({
    key: 'shortcut.chat.toggle_new_context',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'toggle_new_context'
  }),
  defineShortcut({
    key: 'shortcut.chat.copy_last_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'copy_last_message'
  }),
  defineShortcut({
    key: 'shortcut.chat.edit_last_user_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'edit_last_user_message'
  }),
  defineShortcut({
    key: 'shortcut.chat.select_model',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'select_model'
  }),
  // ==================== Topic shortcuts ====================
  defineShortcut({
    key: 'shortcut.topic.new',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'new_topic'
  }),
  defineShortcut({
    key: 'shortcut.topic.rename',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'rename_topic'
  }),
  defineShortcut({
    key: 'shortcut.topic.toggle_show_topics',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'toggle_show_topics'
  }),
  // ==================== Feature shortcuts ====================
  defineShortcut({
    key: 'shortcut.feature.quick_assistant.toggle_window',
    scope: 'main',
    category: 'feature.quick_assistant',
    labelKey: 'mini_window',
    global: true,
    enabledWhen: 'feature.quick_assistant.enabled'
  }),
  defineShortcut({
    key: 'shortcut.feature.selection.toggle_enabled',
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_toggle',
    global: true,
    enabledWhen: 'feature.selection.enabled',
    supportedPlatforms: ['darwin', 'win32']
  }),
  defineShortcut({
    key: 'shortcut.feature.selection.get_text',
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_select_text',
    global: true,
    enabledWhen: 'feature.selection.enabled',
    supportedPlatforms: ['darwin', 'win32']
  })
] as const satisfies readonly ShortcutDefinition[]

export type ShortcutLabelKey = (typeof SHORTCUT_DEFINITIONS)[number]['labelKey']

const definitionMap = new Map<ShortcutPreferenceKey, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.key, definition])
)

export const findShortcutDefinition = (key: ShortcutPreferenceKey): ShortcutDefinition | undefined => {
  return definitionMap.get(key)
}
