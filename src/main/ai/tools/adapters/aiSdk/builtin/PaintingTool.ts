/**
 * Image generation tool — agentic.
 *
 * The model supplies a prompt, model-supported canonical parameters, and optional image references.
 * The actual generation/editing (painting-model resolution, vendor
 * mapping, persistence) lives in the shared `painting` core so the Claude Code
 * MCP bridge runs the exact same logic; this file is just the AI-SDK `dynamicTool()`
 * wrapper.
 */

import { dynamicTool } from 'ai'

import { artifactService } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import { GENERATE_IMAGE_TOOL_NAME } from '@shared/ai/builtinTools'

import { buildGenerateImageToolSchema, type GenerateImageToolInput } from '../../../generateImageTool'
import {
  type ConfiguredPaintingModel,
  GENERATE_IMAGE_DESCRIPTION,
  generateImageFromPrompt,
  isPaintingError,
  paintingModelOutput,
  type PaintingResult
} from '../../../painting'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { GENERATE_IMAGE_TOOL_NAME }

const logger = loggerService.withContext('PaintingTool')

/** Index the images for the Assistant's Outputs; a failed index write never fails the generation. */
function recordTopicImages(topicId: string, files: readonly { id: string }[]): void {
  try {
    artifactService.recordTopicFiles(
      topicId,
      files.map((file) => file.id)
    )
  } catch (error) {
    logger.warn('Failed to index generated images', { topicId, error })
  }
}

function buildGenerateImageTool(configuredModel?: ConfiguredPaintingModel) {
  const inputSchema = buildGenerateImageToolSchema(configuredModel?.support)
  return dynamicTool({
    description: GENERATE_IMAGE_DESCRIPTION,
    inputSchema,
    execute: async (input, options) => {
      const parsed = inputSchema.parse(input) as GenerateImageToolInput
      const { request } = getToolCallContext(options)
      const output =
        configuredModel === undefined
          ? await generateImageFromPrompt(parsed, request.abortSignal)
          : await generateImageFromPrompt(parsed, request.abortSignal, configuredModel)
      if (request.topicId && !isPaintingError(output)) recordTopicImages(request.topicId, output)
      return output
    },
    toModelOutput: ({ output }) => paintingModelOutput(output as PaintingResult)
  })
}

const fallbackGenerateImageTool = buildGenerateImageTool()

export function createGenerateImageToolEntry(): ToolEntry {
  return {
    name: GENERATE_IMAGE_TOOL_NAME,
    namespace: 'media',
    description: 'Generate an image from a text prompt',
    defer: 'auto',
    tool: fallbackGenerateImageTool,
    buildTool: (scope) => buildGenerateImageTool(scope.paintingModel),
    // Two gates: the composer toggle (`assistant.settings.enableGenerateImage`) is the user's per-assistant
    // opt-in, and a global painting model (Settings > Default Model) is what the tool actually generates with.
    // Both are required — without a model there is nothing to generate; without the opt-in the model
    // shouldn't be offered image generation at all.
    applies: (scope) => Boolean(scope.paintingModel) && Boolean(scope.assistant?.settings?.enableGenerateImage)
  }
}

export type { GenerateImageToolInput }
export type GenerateImageToolOutput = PaintingResult
