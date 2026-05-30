import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

import NewContextButton from './components/NewContextButton'

const newContextTool = defineTool({
  key: 'new_context',
  label: (t) => t('chat.input.new.context', { Command: '' }),
  visibleInScopes: [TopicType.Chat],
  dependencies: {
    actions: ['onNewContext'] as const
  },
  render: ({ actions }) => <NewContextButton onNewContext={actions.onNewContext} />
})

registerTool(newContextTool)

export default newContextTool
