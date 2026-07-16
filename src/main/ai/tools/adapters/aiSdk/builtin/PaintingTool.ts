/**
 * Image generation tool — agentic.
 *
 * The model supplies a prompt (and optional count) and may call this
 * more than once. The actual generation (painting-model resolution, vendor
 * mapping, persistence) lives in the shared `painting` core so the Claude Code
 * MCP bridge runs the exact same logic; this file is just the AI-SDK `tool()`
 * wrapper.
 */

import { application } from '@application'
import {
  GENERATE_IMAGE_TOOL_NAME,
  generateImageOutputSchema,
  generateImageStrictInputSchema
} from '@shared/ai/builtinTools'
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
  // `strict: true` needs every field in `required`; the strict schema makes `n` nullable (not
  // optional) so a strict OpenAI-compatible provider doesn't reject the whole tool schema.
  inputSchema: generateImageStrictInputSchema,
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
    namespace: 'media',
    description: 'Generate an image from a text prompt',
    defer: 'auto',
    tool: generateImageTool,
    // Two gates: the composer toggle (`assistant.settings.enableGenerateImage`) is the user's per-assistant
    // opt-in, and a global painting model (Settings > Default Model) is what the tool actually generates with.
    // Both are required — without a model there is nothing to generate; without the opt-in the model
    // shouldn't be offered image generation at all.
    applies: (scope) =>
      Boolean(application.get('PreferenceService').get('feature.paintings.default_model_id')) &&
      Boolean(scope.assistant?.settings?.enableGenerateImage)
  }
}

export type GenerateImageToolInput = InferToolInput<typeof generateImageTool>
export type GenerateImageToolOutput = InferToolOutput<typeof generateImageTool>
