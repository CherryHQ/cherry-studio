import { ActionIconButton } from '@renderer/components/Buttons'
import { useResolvedCommand } from '@renderer/hooks/command'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
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
    const newTopicShortcut = useResolvedCommand('topic.create').shortcutLabel

    return (
      <Tooltip
        placement="top"
        title={t('chat.input.new_topic', { Command: newTopicShortcut })}
        mouseLeaveDelay={0}
        arrow>
        <ActionIconButton onClick={actions.addNewTopic} icon={<MessageSquareDiff size={19} />}></ActionIconButton>
      </Tooltip>
    )
  }
})

// Register the tool
registerTool(newTopicTool)

export default newTopicTool
