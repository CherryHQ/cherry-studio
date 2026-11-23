import { asSchema, safeParseJSON, safeValidateTypes, type ValidationResult } from '@ai-sdk/provider-utils'
import {
  InvalidToolInputError,
  jsonSchema,
  type JSONSchema7,
  Output,
  type ToolCallRepairFunction,
  type ToolSet
} from 'ai'

import { type AiPlugin, generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'

import type { AppProviderSettingsMap } from '../../../types'
import { createMcpJsonSchemaValidator } from './mcpSchema'

const logger = loggerService.withContext('repairToolCall')

type AppProviderId = StringKeys<AppProviderSettingsMap>

export interface AiRepairContext<T extends AppProviderId = AppProviderId> {
  /** Same provider id as the main request — repair stays on the same model. */
  providerId: T
  /** Provider settings for the same provider; passed straight to ai-core. */
  providerSettings: AppProviderSettingsMap[T]
  /** Same model id as the main request. */
  modelId: string
  /** Per-call headers from the owning chat request. */
  headers?: Record<string, string | undefined>
  /** Reuse the request's usage middleware so repair is its own invocation. */
  getUsagePlugins?: () => AiPlugin[]
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

    const schema = asSchema(tools[toolCall.toolName].inputSchema)
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The selected tool's native or JSON Schema validator determines the repaired input type.
    let validate: (value: unknown) => Promise<ValidationResult<unknown>>

    if (schema.validate) {
      validate = (value) => safeValidateTypes({ value, schema })
    } else {
      try {
        const validator = createMcpJsonSchemaValidator(schemaJson)
        validate = async (value) => validator(value)
      } catch (err) {
        logger.warn('AI repair cannot validate the tool JSON Schema', err as Error, {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId
        })

        return null
      }
    }

    /** Successful validation of canonical input, or undefined when no candidate fits the tool schema. */
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Model output and reparsed JSON remain untrusted until the selected tool's validator accepts a candidate.
    const canonicalize = async (value: unknown) => {
      const candidates = [value]

      if (typeof value === 'string') {
        const reparsed = await safeParseJSON({ text: value })

        if (reparsed.success) candidates.push(reparsed.value)
      }

      for (const candidate of candidates) {
        const direct = await validate(candidate)

        if (direct.success && direct.value !== undefined) return direct

        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          Object.keys(candidate).length === 1 &&
          'arguments' in candidate
        ) {
          const unwrapped = await validate(candidate.arguments)

          if (unwrapped.success && unwrapped.value !== undefined) return unwrapped
        }
      }

      return undefined
    }

    const inputStr = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input)

    const parsedInput = await safeParseJSON({ text: inputStr })
    const canonicalInput = parsedInput.success ? await canonicalize(parsedInput.value) : undefined

    if (canonicalInput !== undefined) {
      logger.info('Repaired tool call without AI', {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId
      })

      return { ...toolCall, input: JSON.stringify(canonicalInput.value) }
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
          headers: ctx.headers,
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

    return { ...toolCall, input: JSON.stringify(validated.value) }
  }
}
