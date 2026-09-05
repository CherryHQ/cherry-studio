import { asSchema, safeValidateTypes } from '@ai-sdk/provider-utils'
import { type AiPlugin, generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
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
import * as z from 'zod'

import type { AppProviderSettingsMap } from '../../../types'

const logger = loggerService.withContext('repairToolCall')

type AppProviderId = StringKeys<AppProviderSettingsMap>

export interface AiRepairContext<T extends AppProviderId = AppProviderId> {
  /** Same provider id as the main request — repair stays on the same model. */
  providerId: T
  /** Provider settings for the same provider; passed straight to ai-core. */
  providerSettings: AppProviderSettingsMap[T]
  /** Same model id as the main request. */
  modelId: string
  /** Reuse the request's usage middleware so repair is its own invocation. */
  getUsagePlugins?: () => AiPlugin[]
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function createAiRepair<T extends AppProviderId>(ctx: AiRepairContext<T>): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, inputSchema }) => {
    if (!InvalidToolInputError.isInstance(error)) return null

    let schemaJson: JSONSchema7
    try {
      schemaJson = await inputSchema({ toolName: toolCall.toolName })
    } catch {
      return null
    }

    let schema = asSchema(tools[toolCall.toolName].inputSchema)
    if (!schema.validate) {
      try {
        schema = asSchema(z.fromJSONSchema(schemaJson as Parameters<typeof z.fromJSONSchema>[0]))
      } catch (err) {
        logger.warn('AI repair cannot validate the tool JSON Schema', err as Error, {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId
        })
        return null
      }
    }

    /** Canonical input, or undefined when the value does not fit the tool schema. */
    const canonicalize = async (value: unknown): Promise<unknown> => {
      const direct = await safeValidateTypes({ value, schema })
      if (direct.success) return direct.value
      // Double-encoded arguments — the one malformation a re-parse alone canonicalizes.
      if (typeof value !== 'string') return undefined
      const reparsed = await safeValidateTypes({ value: parseJson(value), schema })
      return reparsed.success ? reparsed.value : undefined
    }

    const inputStr = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input)

    const parsedInput = parseJson(inputStr)
    const canonicalInput = parsedInput === undefined ? undefined : await canonicalize(parsedInput)
    if (canonicalInput !== undefined) {
      logger.info('Repaired tool call without AI', {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId
      })
      return { ...toolCall, input: JSON.stringify(canonicalInput) }
    }

    const prompt = [
      `The previous tool call had invalid arguments. Produce a corrected JSON object that matches the schema, preserving the original intent.`,
      ``,
      `Tool: ${toolCall.toolName}`,
      `Original arguments: ${inputStr}`,
      `Validation error: ${error.message}`
    ].join('\n')

    let repaired: unknown
    try {
      const result = await aiCoreGenerateText<AppProviderSettingsMap, T>(
        ctx.providerId,
        ctx.providerSettings,
        {
          model: ctx.modelId,
          prompt,
          output: Output.object({ schema: jsonSchema(schemaJson) })
        },
        ctx.getUsagePlugins?.()
      )
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

    const validated = await canonicalize(repaired)
    if (validated === undefined) {
      logger.warn('AI repair returned invalid structured output', {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId
      })
      return null
    }

    logger.info('Repaired tool call via AI', {
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId
    })
    return { ...toolCall, input: JSON.stringify(validated) }
  }
}
