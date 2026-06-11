import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { isSupportedToolUse } from '@renderer/utils/assistant'

import McpToolsButton from './components/McpToolsButton'

const mcpToolsTool = defineTool({
  key: 'mcp_tools',
  label: (t) => t('settings.mcp.title'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => isSupportedToolUse(model),
  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },
  render: ({ assistant, actions, quickPanel }) => (
    <McpToolsButton
      assistantId={assistant.id}
      quickPanel={quickPanel}
      setInputValue={actions.onTextChange}
      resizeTextArea={actions.resizeTextArea}
    />
  )
})

registerTool(mcpToolsTool)

export default mcpToolsTool
