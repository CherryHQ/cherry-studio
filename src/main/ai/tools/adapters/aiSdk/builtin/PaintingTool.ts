/**
 * Image generation tool — agentic.
 *
 * The model supplies a prompt (and optional size / count) and may call this
 * more than once. The actual generation (painting-model resolution, vendor
 * mapping, persistence) lives in the shared `painting` core so the Claude Code
 * MCP bridge runs the exact same logic; this file is just the AI-SDK `tool()`
 * wrapper.
 */

import { application } from '@main/core/application'
import { GENERATE_IMAGE_TOOL_NAME, generateImageInputSchema, generateImageOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  GENERATE_IMAGE_DESCRIPTION,
  generateImageFromPrompt,
  paintingErrorSchema,
  paintingModelOutput
} from '../../../painting'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { GENERATE_IMAGE_TOOL_NAME }

const generateImageResultSchema = z.union([generateImageOutputSchema, paintingErrorSchema])

const generateImageTool = tool({
  description: GENERATE_IMAGE_DESCRIPTION,
  inputSchema: generateImageInputSchema,
  outputSchema: generateImageResultSchema,
  // Provider-level constrained decoding where supported. Repair fallback
  // (in AiService) handles providers that don't honour `strict`.
  strict: true,
  execute: async (input, options) => generateImageFromPrompt(input, getToolCallContext(options).request.abortSignal),
  toModelOutput: ({ output }) => paintingModelOutput(output)
})

export function createGenerateImageToolEntry(): ToolEntry {
  return {
    name: GENERATE_IMAGE_TOOL_NAME,
    namespace: 'painting',
    description: 'Generate an image from a text prompt',
    defer: 'auto',
    tool: generateImageTool,
    // No assistant-settings flag (the renderer is untouched in this change): expose the tool only
    // once a global painting model is configured in Settings > Default Model. Until then there is
    // nothing to generate with, so offering it would only produce errors.
    applies: () => Boolean(application.get('PreferenceService').get('feature.paintings.model_id'))
  }
}

export type GenerateImageToolInput = InferToolInput<typeof generateImageTool>
export type GenerateImageToolOutput = InferToolOutput<typeof generateImageTool>
