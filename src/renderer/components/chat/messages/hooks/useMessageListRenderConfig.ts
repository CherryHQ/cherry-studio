import { useCallback, useMemo } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import type { MessageRenderConfigUpdate } from '@renderer/components/chat/messages/types'

export function useMessageListRenderConfig() {
  const [userName] = usePreference('app.user.name')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [messageStyle] = usePreference('chat.message.style')
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')
  const [userMessageDefaultExpanded] = usePreference('chat.message.user_content.default_expanded')
  const [codeFancyBlock] = usePreference('chat.code.fancy_block')
  const [thoughtAutoCollapse] = usePreference('chat.message.thought.auto_collapse')
  const [keepIntermediateAssistantText] = usePreference('chat.message.keep_intermediate_text')
  const [mathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')
  const [showMessageOutline] = usePreference('chat.message.show_outline')
  const [showEstimatedTokens] = usePreference('chat.input.show_estimated_tokens')
  const [multiModelMessageStyle] = usePreference('chat.message.multi_model.style')
  const [multiModelFoldDisplayMode, setMultiModelFoldDisplayMode] = usePreference(
    'chat.message.multi_model.fold_display_mode'
  )
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
      userMessageDefaultExpanded,
      codeFancyBlock,
      thoughtAutoCollapse,
      collapseCompletedToolHistory: true,
      expandToolSteps: false,
      keepIntermediateAssistantText,
      mathEnableSingleDollar,
      showMessageOutline,
      showEstimatedTokens,
      multiModelMessageStyle,
      multiModelFoldDisplayMode,
      multiModelGridColumns,
      multiModelGridPopoverTrigger
    }),
    [
      fontSize,
      codeFancyBlock,
      keepIntermediateAssistantText,
      mathEnableSingleDollar,
      messageFont,
      messageStyle,
      multiModelFoldDisplayMode,
      multiModelGridColumns,
      multiModelGridPopoverTrigger,
      multiModelMessageStyle,
      narrowMode,
      renderInputMessageAsMarkdown,
      userMessageDefaultExpanded,
      showEstimatedTokens,
      showMessageOutline,
      thoughtAutoCollapse,
      userName
    ]
  )

  const updateRenderConfig = useCallback(
    (updates: MessageRenderConfigUpdate) => {
      if (typeof updates.multiModelGridColumns === 'number') {
        void setMultiModelGridColumns(updates.multiModelGridColumns)
      }

      if (updates.multiModelGridPopoverTrigger) {
        void setMultiModelGridPopoverTrigger(updates.multiModelGridPopoverTrigger)
      }

      if (updates.multiModelFoldDisplayMode) {
        void setMultiModelFoldDisplayMode(updates.multiModelFoldDisplayMode)
      }
    },
    [setMultiModelFoldDisplayMode, setMultiModelGridColumns, setMultiModelGridPopoverTrigger]
  )

  return { renderConfig, updateRenderConfig }
}
