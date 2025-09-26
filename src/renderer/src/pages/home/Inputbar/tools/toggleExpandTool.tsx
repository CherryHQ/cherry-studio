import { ActionIconButton } from '@renderer/components/Buttons'
import { defineTool, registerTool, ToolRenderContext, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { Maximize, Minimize } from 'lucide-react'
import React, { useCallback } from 'react'

type ToggleExpandRenderContext = ToolRenderContext<
  readonly ['isExpanded'],
  readonly ['setIsExpanded', 'resizeTextArea']
>

const ToggleExpandTool: React.FC<{ context: ToggleExpandRenderContext }> = ({ context }) => {
  const { actions, state, t } = context
  const isExpanded = Boolean(state.isExpanded)

  const handleToggle = useCallback(() => {
    actions.setIsExpanded?.((previous: boolean) => {
      const next = typeof previous === 'boolean' ? !previous : !isExpanded
      return next
    })
    actions.resizeTextArea?.()
  }, [actions, isExpanded])

  return (
    <Tooltip
      placement="top"
      title={isExpanded ? t('chat.input.collapse') : t('chat.input.expand')}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={handleToggle}>
        {isExpanded ? <Minimize size={18} /> : <Maximize size={18} />}
      </ActionIconButton>
    </Tooltip>
  )
}

const toggleExpandTool = defineTool({
  key: 'toggle_expand',
  label: (t) => t('chat.input.expand'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features }) => !!features.enableExpand,
  dependencies: {
    state: ['isExpanded'] as const,
    actions: ['setIsExpanded', 'resizeTextArea'] as const
  },
  render: (context) => <ToggleExpandTool context={context} />
})

registerTool(toggleExpandTool)

export default toggleExpandTool
