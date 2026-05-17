import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import {
  InvalidToolInputError,
  jsonSchema,
  type JSONSchema7,
  Output,
  type ToolCallRepairFunction,
  type ToolSet
} from 'ai'

import type { AppProviderSettingsMap } from '../types'

const logger = loggerService.withContext('repairToolCall')

type AppProviderId = StringKeys<AppProviderSettingsMap>

export interface AiRepairContext<T extends AppProviderId = AppProviderId> {
  /** Same provider id as the main request — repair stays on the same model. */
  providerId: T
  /** Provider settings for the same provider; passed straight to ai-core. */
  providerSettings: AppProviderSettingsMap[T]
  /** Same model id as the main request. */
  modelId: string
}

export function createAiRepair<T extends AppProviderId>(ctx: AiRepairContext<T>): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error, inputSchema }) => {
    if (!InvalidToolInputError.isInstance(error)) return null

    let schemaJson: JSONSchema7
    try {
      schemaJson = await inputSchema({ toolName: toolCall.toolName })
    } catch {
      return null
    }

    const inputStr = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input)

    const prompt = [
      `The previous tool call had invalid arguments. Produce a corrected JSON object that matches the schema, preserving the original intent.`,
      ``,
      `Tool: ${toolCall.toolName}`,
      `Original arguments: ${inputStr}`,
      `Validation error: ${error.message}`
    ].join('\n')

    let repaired: unknown
    try {
      const result = await aiCoreGenerateText<AppProviderSettingsMap, T>(ctx.providerId, ctx.providerSettings, {
        model: ctx.modelId,
        prompt,
        output: Output.object({ schema: jsonSchema(schemaJson) })
      })
      repaired = result.output
    } catch (err) {
      logger.warn('AI repair generateText failed', err as Error, {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId
      })
      return null
    }

    if (repaired === undefined || repaired === null) {
      logger.warn('AI repair returned no structured output', {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId
      })
      return null
    }

    logger.info('Repaired tool call via AI', {
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId
    })
    return { ...toolCall, input: JSON.stringify(repaired) }
  }
}
