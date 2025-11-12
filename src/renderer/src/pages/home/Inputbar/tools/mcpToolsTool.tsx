import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'

import MCPToolsButton from './components/MCPToolsButton'

const mcpToolsTool = defineTool({
  key: 'mcp_tools',
  label: (t) => t('settings.mcp.title'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ assistant }) => isSupportedToolUse(assistant) || isPromptToolUse(assistant),
  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },
  render: ({ assistant, actions, quickPanel }) => (
    <MCPToolsButton
      assistantId={assistant.id}
      quickPanel={quickPanel}
      setInputValue={actions.onTextChange}
      resizeTextArea={actions.resizeTextArea}
    />
  )
})

registerTool(mcpToolsTool)

export default mcpToolsTool
