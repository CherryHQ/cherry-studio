import { usePreference } from '@data/hooks/usePreference'
import { useMemo } from 'react'

import type { MessageEditorConfig } from '../types'

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
