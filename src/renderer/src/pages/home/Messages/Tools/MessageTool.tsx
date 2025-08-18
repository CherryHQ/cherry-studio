import { MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse } from 'antd'

import { MessageKnowledgeSearchToolBody, MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageWebSearchToolBody, MessageWebSearchToolTitle } from './MessageWebSearchTool'

interface Props {
  block: ToolMessageBlock
}
const prefix = 'builtin_'

// const toolNameMapText = {
//   web_search: i18n.t('message.searching')
// }
// const toolDoneNameMapText = (args: Record<string, any>) => {
//   const count = args.count ?? 0
//   return i18n.t('message.websearch.fetch_complete', { count })
// }

// const PrepareTool = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
//   const toolNameText = useMemo(
//     () => toolNameMapText[toolResponse.tool.name] || toolResponse.tool.name,
//     [toolResponse.tool]
//   )

//   return (
//     <Spinner
//       text={
//         <PrepareToolWrapper>
//           {toolNameText}
//           <span>{JSON.stringify(toolResponse.arguments)}</span>
//         </PrepareToolWrapper>
//       }
//     />
//   )
// }

// const DoneTool = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
//   const toolDoneNameText = useMemo(
//     () => toolDoneNameMapText({ count: toolResponse.response?.data?.length ?? 0 }),
//     [toolResponse.response]
//   )
//   return <p>{toolDoneNameText}</p>
// }

// const ToolLabelComponents = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
//   if (webSearchToolNames.includes(toolResponse.tool.name)) {
//     return <MessageWebSearchToolTitle toolResponse={toolResponse} />
//   }
//   return <MessageWebSearchToolTitle toolResponse={toolResponse} />
// }

// const ToolBodyComponents = ({ toolResponse }: { toolResponse: MCPToolResponse }) => {
//   if (webSearchToolNames.includes(toolResponse.tool.name)) {
//     return <MessageWebSearchToolBody toolResponse={toolResponse} />
//   }
//   return <MessageWebSearchToolBody toolResponse={toolResponse} />
// }

const ChooseTool = (toolResponse: MCPToolResponse): { label: React.ReactNode; body: React.ReactNode } | null => {
  let toolName = toolResponse.tool.name
  if (toolName.startsWith(prefix)) {
    toolName = toolName.slice(prefix.length)
  }

  switch (toolName) {
    case 'web_search':
    case 'web_search_preview':
      return {
        label: <MessageWebSearchToolTitle toolResponse={toolResponse} />,
        body: <MessageWebSearchToolBody toolResponse={toolResponse} />
      }
    case 'knowledge_search':
      return {
        label: <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />,
        body: <MessageKnowledgeSearchToolBody toolResponse={toolResponse} />
      }
    default:
      return null
  }
}

export default function MessageTool({ block }: Props) {
  // FIXME: 语义错误，这里已经不是 MCP tool 了
  const toolResponse = block.metadata?.rawMcpToolResponse
  if (!toolResponse) return null

  const toolRenderer = ChooseTool(toolResponse)

  if (!toolRenderer) return null

  return (
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
  )
}
// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
