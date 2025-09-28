import { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse } from 'antd'

import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

interface Props {
  block: ToolMessageBlock
}
const prefix = 'builtin_'

const ChooseTool = (toolResponse: NormalToolResponse): { label: React.ReactNode; body: React.ReactNode } | null => {
  let toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type
  if (toolName.startsWith(prefix)) {
    toolName = toolName.slice(prefix.length)
  }

  switch (toolName) {
    case 'web_search':
    case 'web_search_preview':
      return toolType === 'provider'
        ? null
        : {
            label: <MessageWebSearchToolTitle toolResponse={toolResponse} />,
            body: null
          }
    case 'knowledge_search':
      return {
        label: <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />,
        body: null
      }
    case 'memory_search':
      return {
        label: <MessageMemorySearchToolTitle toolResponse={toolResponse} />,
        body: null
      }
    default:
      return null
  }
}

export default function MessageTool({ block }: Props) {
  // FIXME: 语义错误，这里已经不是 MCP tool 了,更改rawMcpToolResponse需要改用户数据, 所以暂时保留
  const toolResponse = block.metadata?.rawMcpToolResponse as NormalToolResponse

  if (!toolResponse) return null

  const toolRenderer = ChooseTool(toolResponse)

  if (!toolRenderer) return null

  return toolRenderer.body ? (
    <Collapse
      items={[
        {
          key: '1',
          label: toolRenderer.label,
          children: toolRenderer.body,
          showArrow: false,
          styles: {
            header: {
              paddingLeft: '0'
            }
          }
        }
      ]}
      size="small"
      ghost
    />
  ) : (
    toolRenderer.label
  )
}
// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
