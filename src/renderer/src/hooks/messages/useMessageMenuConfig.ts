import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import type { MessageMenuConfig } from '@renderer/components/chat/messages/types'
import { defaultMessageMenuExportOptions } from '@renderer/components/chat/messages/types'
import { useMemo } from 'react'

const MESSAGE_EXPORT_MENU_PREFERENCE_KEYS = {
  image: 'data.export.menus.image',
  markdown: 'data.export.menus.markdown',
  markdown_reason: 'data.export.menus.markdown_reason',
  notion: 'data.export.menus.notion',
  yuque: 'data.export.menus.yuque',
  joplin: 'data.export.menus.joplin',
  obsidian: 'data.export.menus.obsidian',
  siyuan: 'data.export.menus.siyuan',
  docx: 'data.export.menus.docx',
  plain_text: 'data.export.menus.plain_text'
} as const

export function useMessageMenuConfig(): MessageMenuConfig {
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [confirmDeleteMessage] = usePreference('chat.message.confirm_delete')
  const [confirmRegenerateMessage] = usePreference('chat.message.confirm_regenerate')
  const [exportMenuOptions] = useMultiplePreferences(MESSAGE_EXPORT_MENU_PREFERENCE_KEYS)

  return useMemo(
    () => ({
      confirmDeleteMessage,
      confirmRegenerateMessage,
      enableDeveloperMode,
      exportMenuOptions: {
        ...defaultMessageMenuExportOptions,
        ...exportMenuOptions
      }
    }),
    [confirmDeleteMessage, confirmRegenerateMessage, enableDeveloperMode, exportMenuOptions]
  )
}
