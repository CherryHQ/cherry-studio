import { chooseTool } from './chooseTool'
import type { ToolResponseLike } from './toolResponse'

interface Props {
  toolResponse: ToolResponseLike
}

export function canRenderMessageToolResponse(toolResponse: ToolResponseLike) {
  return chooseTool(toolResponse) !== null
}

export default function MessageTool({ toolResponse }: Props) {
  const rendered = chooseTool(toolResponse)

  if (!rendered) return null

  return rendered
}
