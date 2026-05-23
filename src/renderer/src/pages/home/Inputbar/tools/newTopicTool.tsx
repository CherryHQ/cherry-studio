import { CommandTooltip } from '@renderer/commands'
import { ActionIconButton } from '@renderer/components/Buttons'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { MessageSquareDiff } from 'lucide-react'

const newTopicTool = defineTool({
  key: 'new_topic',
  label: (t) => t('chat.input.new_topic', { Command: '' }),

  visibleInScopes: [TopicType.Chat],

  dependencies: {
    actions: ['addNewTopic'] as const
  },

  render: function NewTopicRender(context) {
    const { actions, t } = context
    const label = t('chat.input.new_topic', { Command: '' }).trim()

    return (
      <CommandTooltip command="topic.create" label={label}>
        <ActionIconButton onClick={actions.addNewTopic} icon={<MessageSquareDiff size={19} />}></ActionIconButton>
      </CommandTooltip>
    )
  }
})

// Register the tool
registerTool(newTopicTool)

export default newTopicTool
