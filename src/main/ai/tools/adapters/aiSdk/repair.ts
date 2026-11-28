import { asSchema, safeParseJSON, safeValidateTypes } from '@ai-sdk/provider-utils'
import {
  InvalidToolInputError,
  jsonSchema,
  type JSONSchema7,
  NoSuchToolError,
  Output,
  type ToolCallRepairFunction,
  type ToolSet
} from 'ai'
import { and, createRetryableModel, finishReason, result } from 'ai-retry/language-model'

import { type AiPlugin, createExecutor } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'

import type { AppProviderSettingsMap } from '../../../types'
import { createMcpJsonSchemaValidator } from './mcpSchema'
import { resolveRequestToolName } from './toolNameAlias'

const logger = loggerService.withContext('repairToolCall')

type AppProviderId = StringKeys<AppProviderSettingsMap>

export interface AiRepairContext<T extends AppProviderId = AppProviderId> {
  /** Full allowed request catalog, including deferred entries. */
  requestTools?: ToolSet
  /** Same provider id as the main request. */
  providerId: T
  /** Provider settings for the same provider; passed straight to ai-core. */
  providerSettings: AppProviderSettingsMap[T]
  /** Same model id as the main request. */
  modelId: string
  /** Per-call headers from the owning chat request. */
  headers?: Record<string, string | undefined>
  signal?: AbortSignal
  retryInvalidOutput?: boolean
  /** Reuse the request's usage middleware so repair is its own invocation. */
  getUsagePlugins?: () => AiPlugin[]
}

export function createAiRepair<T extends AppProviderId>(ctx: AiRepairContext<T>): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, inputSchema }) => {
    // The model called a name outside the ToolSet. For MCP tools this is
    // usually the human-readable protocol name ('nmap_scan') instead of the
    // wire id ('mcp__{serverSlug}__{toolSlug}_{digest}'): the tool is
    // connected and discovered, yet the call died as "tool is not available"
    // (#24583). A unique protocol-name alias repairs the call in place; an
    // ambiguous or unknown name receives a request-scoped recovery hint.
    if (NoSuchToolError.isInstance(error)) {
      const catalog = ctx.requestTools ?? tools
      const resolved = resolveRequestToolName(toolCall.toolName, new Set(Object.keys(catalog)), (name) => catalog[name])
      if (!tools[resolved]) {
        throw new Error(
          `Tool is deferred in this request: ${toolCall.toolName}; use tool_inspect and tool_invoke with ${resolved}`
        )
      }
      logger.info('Repaired tool call by MCP protocol-name alias', {
        from: toolCall.toolName,
        to: resolved,
        toolCallId: toolCall.toolCallId
      })
      return { ...toolCall, toolName: resolved }
    }

    if (!InvalidToolInputError.isInstance(error)) return null

    let schemaJson: JSONSchema7
    try {
      schemaJson = await inputSchema({ toolName: toolCall.toolName })
    } catch {
      return null
    }

    const schema = asSchema(tools[toolCall.toolName].inputSchema)
    let validate: (value: unknown) => Promise<unknown | undefined>
    if (schema.validate) {
      validate = async (value) => {
        const result = await safeValidateTypes({ value, schema })
        return result.success ? result.value : undefined
      }
    } else {
      try {
        const validator = createMcpJsonSchemaValidator(schemaJson)
        validate = async (value) => {
          const result = validator(value)
          return result.success ? result.value : undefined
        }
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
      const candidates = [value]
      if (typeof value === 'string') {
        const reparsed = await safeParseJSON({ text: value })
        if (reparsed.success) candidates.push(reparsed.value)
      }

      for (const candidate of candidates) {
        const direct = await validate(candidate)
        if (direct !== undefined) return direct
        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          Object.keys(candidate).length === 1 &&
          'arguments' in candidate
        ) {
          const unwrapped = await validate(candidate.arguments)
          if (unwrapped !== undefined) return unwrapped
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
      return { ...toolCall, input: JSON.stringify(canonicalInput) }
    }

    const prompt = [
      `The previous tool call had invalid arguments. Produce a corrected JSON object that matches the schema, preserving the original intent.`,
      ``,
      `Tool: ${toolCall.toolName}`,
      `Original arguments: ${inputStr}`,
      `Validation error: ${error.message}`
    ].join('\n')

    const retryInvalidArguments = and(
      finishReason('stop'),
      result(async ({ content }, { current }) => {
        if (current.options.abortSignal?.aborted) return false
        const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
        const parsed = await safeParseJSON({ text })
        return !parsed.success || (await canonicalize(parsed.value)) === undefined
      })
    ).retry({ maxAttempts: 2 })
    let repaired: unknown
    try {
      const executor = await createExecutor<AppProviderSettingsMap, T>(
        ctx.providerId,
        ctx.providerSettings,
        ctx.getUsagePlugins?.()
      )
      const generated = await executor.generateText(
        {
          model: ctx.modelId,
          headers: ctx.headers,
          abortSignal: ctx.signal,
          prompt,
          output: Output.object({ schema: jsonSchema(schemaJson) })
        },
        ctx.retryInvalidOutput
          ? (model) => createRetryableModel({ model, retries: [retryInvalidArguments] })
          : undefined
      )
      repaired = generated.output
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
