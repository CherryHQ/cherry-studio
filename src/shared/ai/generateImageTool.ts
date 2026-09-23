import { getToolName, isToolUIPart } from 'ai'
import * as z from 'zod'

import type { CherryMessagePart } from '@shared/data/types/message'

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image'

export const generateImageOutputItemSchema = z.object({
  id: z.string().describe('File entry id of the generated image.'),
  name: z.string().describe('File name of the generated image.')
})

export const generateImageOutputSchema = z.array(generateImageOutputItemSchema)

export type GenerateImageOutputItem = z.infer<typeof generateImageOutputItemSchema>
export type GenerateImageOutput = z.infer<typeof generateImageOutputSchema>

export const generatedImageResultSchema = z.object({
  type: z.literal('generated-images'),
  images: generateImageOutputSchema
})
export type GeneratedImageResult = z.infer<typeof generatedImageResultSchema>

export function isGeneratedImageToolName(name: string): boolean {
  return name === GENERATE_IMAGE_TOOL_NAME || name === `mcp__cherry-tools__${GENERATE_IMAGE_TOOL_NAME}`
}

/** Read only known result envelopes; never infer file identities from prose. */
export function generatedImagesFromOutput(output: unknown): GenerateImageOutput {
  const direct = generateImageOutputSchema.safeParse(output)
  if (direct.success) return direct.data
  const envelope = generatedImageResultSchema.safeParse(output)
  if (envelope.success) return envelope.data.images
  if (!output || typeof output !== 'object') return []
  const wire = output as Record<string, unknown>
  if (wire.isError === true) return []
  for (const candidate of [wire.structuredContent, wire.details, wire.content]) {
    const parsed = generatedImageResultSchema.safeParse(candidate)
    if (parsed.success) return parsed.data.images
  }
  const content = Array.isArray(output) ? output : wire.content
  if (!Array.isArray(content)) return []
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > 64_000) continue
    try {
      const parsed = generatedImageResultSchema.safeParse(JSON.parse(block.text))
      if (parsed.success) return parsed.data.images
    } catch {
      /* Non-JSON summaries do not carry file references. */
    }
  }
  return []
}

export function generatedImagesFromPart(part: CherryMessagePart): GenerateImageOutput {
  if (!isToolUIPart(part) || part.state !== 'output-available' || !isGeneratedImageToolName(getToolName(part)))
    return []
  return generatedImagesFromOutput(part.output)
}
