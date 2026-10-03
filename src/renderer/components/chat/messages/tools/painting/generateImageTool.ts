import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { getToolName, isToolUIPart } from 'ai'

import { GENERATE_IMAGE_TOOL_NAME, generateImageOutputSchema } from '@shared/ai/builtinTools'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

const CHERRY_MCP_GENERATE_IMAGE_TOOL_NAME = `mcp__cherry-tools__${GENERATE_IMAGE_TOOL_NAME}`

export function isGenerateImageToolName(toolName: string): boolean {
  return toolName === GENERATE_IMAGE_TOOL_NAME || toolName === CHERRY_MCP_GENERATE_IMAGE_TOOL_NAME
}

export function parseGeneratedImageOutput(response: unknown) {
  const outputParse = generateImageOutputSchema.safeParse(response)
  const mcpOutputParse = CallToolResultSchema.safeParse(response)
  return {
    items: outputParse.success ? outputParse.data : [],
    inlineUrls:
      mcpOutputParse.success && mcpOutputParse.data.isError !== true
        ? mcpOutputParse.data.content.flatMap((item) =>
            item.type === 'image' && item.data ? [`data:${item.mimeType ?? 'image/png'};base64,${item.data}`] : []
          )
        : []
  }
}

export function isGeneratedImageResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available' || !isGenerateImageToolName(getToolName(part))) {
    return false
  }

  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse) return false
  if (isDeferredToolOutput(toolResponse.response)) return true
  const { inlineUrls, items } = parseGeneratedImageOutput(toolResponse.response)
  return inlineUrls.length > 0 || items.length > 0
}
