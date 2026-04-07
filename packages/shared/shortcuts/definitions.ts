import type { ShortcutDefinition } from './types'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  // ==================== 应用级快捷键 ====================
  {
    key: 'shortcut.app.general.show_main_window',
    defaultKey: [],
    scope: 'main',
    category: 'app.general',
    labelKey: 'show_app',
    system: true,
    global: true
  },
  {
    key: 'shortcut.app.general.show_mini_window',
    defaultKey: ['CommandOrControl', 'E'],
    scope: 'main',
    category: 'app.general',
    labelKey: 'mini_window',
    system: true,
    global: true,
    enabledWhen: (getPreference) => !!getPreference('feature.quick_assistant.enabled')
  },
  {
    key: 'shortcut.app.general.show_settings',
    defaultKey: ['CommandOrControl', ','],
    scope: 'both',
    category: 'app.general',
    labelKey: 'show_settings',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.general.toggle_sidebar',
    defaultKey: ['CommandOrControl', '['],
    scope: 'renderer',
    category: 'app.general',
    labelKey: 'toggle_sidebar'
  },
  {
    key: 'shortcut.app.general.exit_fullscreen',
    defaultKey: ['Escape'],
    scope: 'renderer',
    category: 'app.general',
    labelKey: 'exit_fullscreen',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.general.zoom_in',
    defaultKey: ['CommandOrControl', '='],
    scope: 'main',
    category: 'app.general',
    labelKey: 'zoom_in',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numadd']]
  },
  {
    key: 'shortcut.app.general.zoom_out',
    defaultKey: ['CommandOrControl', '-'],
    scope: 'main',
    category: 'app.general',
    labelKey: 'zoom_out',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numsub']]
  },
  {
    key: 'shortcut.app.general.zoom_reset',
    defaultKey: ['CommandOrControl', '0'],
    scope: 'main',
    category: 'app.general',
    labelKey: 'zoom_reset',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.general.search',
    defaultKey: ['CommandOrControl', 'Shift', 'F'],
    scope: 'renderer',
    category: 'app.general',
    labelKey: 'search_message'
  },
  // ==================== 聊天相关快捷键 ====================
  {
    key: 'shortcut.app.chat.clear',
    defaultKey: ['CommandOrControl', 'L'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'clear_topic'
  },
  {
    key: 'shortcut.app.chat.search_message',
    defaultKey: ['CommandOrControl', 'F'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'search_message_in_chat'
  },
  {
    key: 'shortcut.app.chat.toggle_new_context',
    defaultKey: ['CommandOrControl', 'K'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'toggle_new_context'
  },
  {
    key: 'shortcut.app.chat.copy_last_message',
    defaultKey: ['CommandOrControl', 'Shift', 'C'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'copy_last_message'
  },
  {
    key: 'shortcut.app.chat.edit_last_user_message',
    defaultKey: ['CommandOrControl', 'Shift', 'E'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'edit_last_user_message'
  },
  {
    key: 'shortcut.app.chat.select_model',
    defaultKey: ['CommandOrControl', 'Shift', 'M'],
    scope: 'renderer',
    category: 'app.chat',
    labelKey: 'select_model'
  },
  // ==================== 话题管理快捷键 ====================
  {
    key: 'shortcut.app.topic.new',
    defaultKey: ['CommandOrControl', 'N'],
    scope: 'renderer',
    category: 'app.topic',
    labelKey: 'new_topic'
  },
  {
    key: 'shortcut.app.topic.rename',
    defaultKey: ['CommandOrControl', 'T'],
    scope: 'renderer',
    category: 'app.topic',
    labelKey: 'rename_topic'
  },
  {
    key: 'shortcut.app.topic.toggle_show_topics',
    defaultKey: ['CommandOrControl', ']'],
    scope: 'renderer',
    category: 'app.topic',
    labelKey: 'toggle_show_topics'
  },
  // ==================== 划词助手快捷键 ====================
  {
    key: 'shortcut.feature.selection.toggle_enabled',
    defaultKey: [],
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_toggle',
    system: true,
    global: true,
    supportedPlatforms: ['darwin', 'win32']
  },
  {
    key: 'shortcut.feature.selection.get_text',
    defaultKey: [],
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_select_text',
    system: true,
    global: true,
    supportedPlatforms: ['darwin', 'win32']
  }
] as const

const definitionMap = new Map<string, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.key, definition])
)

export const findShortcutDefinition = (key: string): ShortcutDefinition | undefined => {
  return definitionMap.get(key)
}
