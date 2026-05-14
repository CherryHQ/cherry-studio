import { usePreference } from '@data/hooks/usePreference'
import { useCallback, useMemo } from 'react'

import type { MessageRenderConfigUpdate } from '../types'

export function useMessageListRenderConfig() {
  const [userName] = usePreference('app.user.name')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [messageStyle] = usePreference('chat.message.style')
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [showMessageOutline] = usePreference('chat.message.show_outline')
  const [multiModelMessageStyle] = usePreference('chat.message.multi_model.style')
  const [multiModelGridColumns, setMultiModelGridColumns] = usePreference('chat.message.multi_model.grid_columns')
  const [multiModelGridPopoverTrigger, setMultiModelGridPopoverTrigger] = usePreference(
    'chat.message.multi_model.grid_popover_trigger'
  )

  const renderConfig = useMemo(
    () => ({
      userName,
      narrowMode,
      messageStyle,
      messageFont,
      fontSize,
      showMessageOutline,
      multiModelMessageStyle,
      multiModelGridColumns,
      multiModelGridPopoverTrigger
    }),
    [
      fontSize,
      messageFont,
      messageStyle,
      multiModelGridColumns,
      multiModelGridPopoverTrigger,
      multiModelMessageStyle,
      narrowMode,
      showMessageOutline,
      userName
    ]
  )

  const updateRenderConfig = useCallback(
    (updates: MessageRenderConfigUpdate) => {
      if (typeof updates.multiModelGridColumns === 'number') {
        setMultiModelGridColumns(updates.multiModelGridColumns)
      }

      if (updates.multiModelGridPopoverTrigger) {
        setMultiModelGridPopoverTrigger(updates.multiModelGridPopoverTrigger)
      }
    },
    [setMultiModelGridColumns, setMultiModelGridPopoverTrigger]
  )

  return { renderConfig, updateRenderConfig }
}
