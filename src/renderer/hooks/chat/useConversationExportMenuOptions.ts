import { useMultiplePreferences } from '@data/hooks/usePreference'

const CONVERSATION_EXPORT_MENU_PREFERENCE_KEYS = {
  docx: 'data.export.menus.docx',
  image: 'data.export.menus.image',
  joplin: 'data.export.menus.joplin',
  markdown: 'data.export.menus.markdown',
  markdown_reason: 'data.export.menus.markdown_reason',
  notion: 'data.export.menus.notion',
  obsidian: 'data.export.menus.obsidian',
  plain_text: 'data.export.menus.plain_text',
  siyuan: 'data.export.menus.siyuan',
  yuque: 'data.export.menus.yuque'
} as const

export function useConversationExportMenuOptions() {
  const [exportMenuOptions] = useMultiplePreferences(CONVERSATION_EXPORT_MENU_PREFERENCE_KEYS)
  return exportMenuOptions
}
