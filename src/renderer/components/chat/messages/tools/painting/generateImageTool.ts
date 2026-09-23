import { getToolName, isToolUIPart } from 'ai'

import { generatedImagesFromOutput, isGeneratedImageToolName } from '@shared/ai/generateImageTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

export const isGenerateImageToolName = isGeneratedImageToolName

export function parseGeneratedImageOutput(response: unknown) {
  const content =
    response && typeof response === 'object' && !Array.isArray(response) && Array.isArray((response as any).content)
      ? ((response as { content: unknown[] }).content as Array<Record<string, unknown>>)
      : null
  const inlineItems: Array<{ id: string; name: string }> = []
  const inlineUrls: string[] = []
  for (const item of content ?? []) {
    if (item.type !== 'image') continue
    if (typeof item.assetId === 'string' && item.assetId) {
      inlineItems.push({ id: item.assetId, name: 'generated-image.png' })
      continue
    }
    if (typeof item.data === 'string' && item.data) {
      inlineUrls.push(`data:${typeof item.mimeType === 'string' ? item.mimeType : 'image/png'};base64,${item.data}`)
    }
  }
  return {
    items: generatedImagesFromOutput(response),
    inlineItems,
    inlineUrls
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
