import NewContextButton from '@renderer/pages/home/Inputbar/NewContextButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

const newContextTool = defineTool({
  key: 'new_context',
  label: (t) => t('chat.input.new.context', { Command: '' }),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features }) => !!features.enableNewContext,
  dependencies: {
    actions: ['onNewContext'] as const
  },
  render: ({ actions }) => <NewContextButton onNewContext={actions.onNewContext} />
})

registerTool(newContextTool)

export default newContextTool
