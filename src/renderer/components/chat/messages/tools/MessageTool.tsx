import type { NormalToolResponse } from '@renderer/types'

import { chooseTool } from './chooseTool'

interface Props {
  toolResponse: NormalToolResponse
}

export function canRenderMessageToolResponse(toolResponse: NormalToolResponse) {
  return chooseTool(toolResponse) !== null
}

export default function MessageTool({ toolResponse }: Props) {
  const rendered = chooseTool(toolResponse)
  if (!rendered) return null
  return rendered
}
