import { CommandTooltip } from '@renderer/commands'
import { ActionIconButton } from '@renderer/components/Buttons'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
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
    const label = t('chat.input.clear.label', { Command: '' }).trim()

    return (
      <CommandTooltip command="chat.topic.clear" label={label}>
        <ActionIconButton onClick={actions.clearTopic} icon={<PaintbrushVertical size={18} />}></ActionIconButton>
      </CommandTooltip>
    )
  }
})

registerTool(clearTopicTool)

export default clearTopicTool
