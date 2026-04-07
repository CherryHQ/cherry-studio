import type { ShortcutDefinition } from './types'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  // ==================== 应用级快捷键 ====================
  {
    key: 'shortcut.app.show_main_window',
    defaultKey: [],
    scope: 'main',
    category: 'app',
    labelKey: 'show_app',
    system: true,
    persistOnBlur: true
  },
  {
    key: 'shortcut.app.show_mini_window',
    defaultKey: ['CommandOrControl', 'E'],
    scope: 'main',
    category: 'selection',
    labelKey: 'mini_window',
    system: true,
    persistOnBlur: true,
    enabledWhen: (getPreference) => !!getPreference('feature.quick_assistant.enabled')
  },
  {
    key: 'shortcut.app.show_settings',
    defaultKey: ['CommandOrControl', ','],
    scope: 'both',
    category: 'app',
    labelKey: 'show_settings',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.toggle_show_assistants',
    defaultKey: ['CommandOrControl', '['],
    scope: 'renderer',
    category: 'app',
    labelKey: 'toggle_show_assistants'
  },
  {
    key: 'shortcut.app.exit_fullscreen',
    defaultKey: ['Escape'],
    scope: 'renderer',
    category: 'app',
    labelKey: 'exit_fullscreen',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.zoom_in',
    defaultKey: ['CommandOrControl', '='],
    scope: 'main',
    category: 'app',
    labelKey: 'zoom_in',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numadd']]
  },
  {
    key: 'shortcut.app.zoom_out',
    defaultKey: ['CommandOrControl', '-'],
    scope: 'main',
    category: 'app',
    labelKey: 'zoom_out',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numsub']]
  },
  {
    key: 'shortcut.app.zoom_reset',
    defaultKey: ['CommandOrControl', '0'],
    scope: 'main',
    category: 'app',
    labelKey: 'zoom_reset',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.search_message',
    defaultKey: ['CommandOrControl', 'Shift', 'F'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'search_message'
  },
  // ==================== 聊天相关快捷键 ====================
  {
    key: 'shortcut.chat.clear',
    defaultKey: ['CommandOrControl', 'L'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'clear_topic'
  },
  {
    key: 'shortcut.chat.search_message',
    defaultKey: ['CommandOrControl', 'F'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'search_message_in_chat'
  },
  {
    key: 'shortcut.chat.toggle_new_context',
    defaultKey: ['CommandOrControl', 'K'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'toggle_new_context'
  },
  {
    key: 'shortcut.chat.copy_last_message',
    defaultKey: ['CommandOrControl', 'Shift', 'C'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'copy_last_message'
  },
  {
    key: 'shortcut.chat.edit_last_user_message',
    defaultKey: ['CommandOrControl', 'Shift', 'E'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'edit_last_user_message'
  },
  {
    key: 'shortcut.chat.select_model',
    defaultKey: ['CommandOrControl', 'Shift', 'M'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'select_model'
  },
  // ==================== 话题管理快捷键 ====================
  {
    key: 'shortcut.topic.new',
    defaultKey: ['CommandOrControl', 'N'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'new_topic'
  },
  {
    key: 'shortcut.topic.rename',
    defaultKey: ['CommandOrControl', 'T'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'rename_topic'
  },
  {
    key: 'shortcut.topic.toggle_show_topics',
    defaultKey: ['CommandOrControl', ']'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'toggle_show_topics'
  },
  // ==================== 划词助手快捷键 ====================
  {
    key: 'shortcut.selection.toggle_enabled',
    defaultKey: [],
    scope: 'main',
    category: 'selection',
    labelKey: 'selection_assistant_toggle',
    system: true,
    persistOnBlur: true,
    supportedPlatforms: ['darwin', 'win32']
  },
  {
    key: 'shortcut.selection.get_text',
    defaultKey: [],
    scope: 'main',
    category: 'selection',
    labelKey: 'selection_assistant_select_text',
    system: true,
    persistOnBlur: true,
    supportedPlatforms: ['darwin', 'win32']
  }
] as const

const definitionMap = new Map<string, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.key, definition])
)

export const findShortcutDefinition = (key: string): ShortcutDefinition | undefined => {
  return definitionMap.get(key)
}
