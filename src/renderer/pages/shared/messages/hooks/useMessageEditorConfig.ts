import { usePreference } from '@data/hooks/usePreference'
import type { MessageEditorConfig } from '@renderer/components/chat/messages/types'
import { useMemo } from 'react'

export function useMessageEditorConfig(fontSize: number): MessageEditorConfig {
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')

  return useMemo(
    () => ({
      fontSize,
      sendMessageShortcut,
      enableSpellCheck
    }),
    [enableSpellCheck, fontSize, sendMessageShortcut]
  )
}
