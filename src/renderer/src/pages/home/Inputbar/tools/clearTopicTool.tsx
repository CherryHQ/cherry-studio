import { ActionIconButton } from '@renderer/components/Buttons'
import { useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { PaintbrushVertical } from 'lucide-react'

const clearTopicTool = defineTool({
  key: 'clear_topic',
  label: (t) => t('chat.input.clear.label', { Command: '' }),
  visibleInScopes: [TopicType.Chat],
  dependencies: {
    actions: ['clearTopic'] as const
  },
  render: function ClearTopicRender(context) {
    const { actions, t } = context
    const clearTopicShortcut = useShortcutDisplay('clear_topic')

    return (
      <Tooltip
        placement="top"
        title={t('chat.input.clear.label', { Command: clearTopicShortcut })}
        mouseLeaveDelay={0}
        arrow>
        <ActionIconButton onClick={actions.clearTopic}>
          <PaintbrushVertical size={18} />
        </ActionIconButton>
      </Tooltip>
    )
  }
})

registerTool(clearTopicTool)

export default clearTopicTool
