import { usePreference } from '@data/hooks/usePreference'
import type { MessageEditorConfig } from '@renderer/components/chat/messages/types'
import { useMemo } from 'react'

export function useMessageEditorConfig(fontSize: number): MessageEditorConfig {
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')

  return useMemo(
    () => ({
      pasteLongTextAsFile,
      pasteLongTextThreshold,
      fontSize,
      sendMessageShortcut,
      enableSpellCheck
    }),
    [enableSpellCheck, fontSize, pasteLongTextAsFile, pasteLongTextThreshold, sendMessageShortcut]
  )
}
