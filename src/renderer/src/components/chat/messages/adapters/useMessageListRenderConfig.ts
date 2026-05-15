import { usePreference } from '@data/hooks/usePreference'
import { useCallback, useMemo } from 'react'

import type { MessageRenderConfigUpdate } from '../types'

export function useMessageListRenderConfig() {
  const [userName] = usePreference('app.user.name')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [messageStyle] = usePreference('chat.message.style')
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')
  const [codeFancyBlock] = usePreference('chat.code.fancy_block')
  const [thoughtAutoCollapse] = usePreference('chat.message.thought.auto_collapse')
  const [mathEngine] = usePreference('chat.message.math.engine')
  const [mathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')
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
      renderInputMessageAsMarkdown,
      codeFancyBlock,
      thoughtAutoCollapse,
      mathEngine,
      mathEnableSingleDollar,
      showMessageOutline,
      multiModelMessageStyle,
      multiModelGridColumns,
      multiModelGridPopoverTrigger
    }),
    [
      fontSize,
      codeFancyBlock,
      mathEnableSingleDollar,
      mathEngine,
      messageFont,
      messageStyle,
      multiModelGridColumns,
      multiModelGridPopoverTrigger,
      multiModelMessageStyle,
      narrowMode,
      renderInputMessageAsMarkdown,
      showMessageOutline,
      thoughtAutoCollapse,
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
