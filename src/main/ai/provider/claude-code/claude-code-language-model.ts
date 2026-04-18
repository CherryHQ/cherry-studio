/**
 * LanguageModelV3 implementation backed by the Claude Agent SDK.
 *
 * Simplified for Cherry Studio:
 * - Uses loggerService instead of custom Logger interface
 * - No validation.ts — we control input
 * - No errors.ts — uses @ai-sdk/provider errors directly
 * - No env var filtering — Cherry Studio's buildEnvironment handles it
 * - No doGenerate — Cherry Studio only uses streaming
 * - Keeps the full doStream core (tool lifecycle, truncation, abort)
 */

import type {
  JSONObject,
  JSONValue,
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning
} from '@ai-sdk/provider'
import { APICallError, LoadAPIKeyError, NoSuchModelError } from '@ai-sdk/provider'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import { generateId } from '@ai-sdk/provider-utils'
import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { type Options, query } from '@anthropic-ai/claude-agent-sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaRawContentBlockDeltaEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockStopEvent,
  BetaRawMessageDeltaEvent,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  BetaUsage
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { loggerService } from '@logger'

import type { ClaudeCodeSettings } from './types'

const logger = loggerService.withContext('ClaudeCodeLanguageModel')

// ── Constants ───────────────────────────────────────────────────────

const CLAUDE_CODE_TRUNCATION_WARNING =
  'Claude Code SDK output ended unexpectedly; returning truncated response from buffered text. Await upstream fix to avoid data loss.'

const MIN_TRUNCATION_LENGTH = 512

const MAX_TOOL_RESULT_SIZE = 10000

// ── Internal types ──────────────────────────────────────────────────

/** Tool use with parent tracking (for subagent hierarchy) */
type ToolUseWithParent = BetaToolUseBlock & { parent_tool_use_id?: string | null }

/** Tool result — extends SDK type with optional name from runtime */
type ToolResultWithName = BetaToolResultBlockParam & { name?: string }

// Tool errors use standard `tool-result` with `isError: true` — no custom type needed.

type ToolStreamState = {
  name: string
  lastSerializedInput?: string
  inputStarted: boolean
  inputClosed: boolean
  callEmitted: boolean
  parentToolCallId?: string | null
}

/** Mutable state threaded through all stream handlers. */
type StreamContext = {
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>
  options: Parameters<LanguageModelV3['doStream']>[0]
  toolStates: Map<string, ToolStreamState>
  activeTaskTools: Map<string, { startTime: number }>
  toolBlocksByIndex: Map<number, string>
  toolInputAccumulators: Map<string, string>
  textBlocksByIndex: Map<number, string>
  reasoningBlocksByIndex: Map<number, string>
  currentReasoningPartId: string | undefined
  textPartId: string | undefined
  accumulatedText: string
  streamedTextLength: number
  usage: LanguageModelV3Usage
  hasReceivedStreamEvents: boolean
  hasStreamedJson: boolean
  textStreamedViaContentBlock: boolean
  warnings: SharedV3Warning[]
}

// ── Helpers ─────────────────────────────────────────────────────────

const UNKNOWN_TOOL_NAME = 'unknown-tool'
const MAX_TOOL_INPUT_SIZE = 1_048_576
const MAX_TOOL_INPUT_WARN = 102_400
const MAX_DELTA_CALC_SIZE = 10_000

function isClaudeCodeTruncationError(error: unknown, bufferedText: string): boolean {
  const err = error as { name?: string; message?: string } | null
  const isSyntaxError =
    error instanceof SyntaxError || (typeof err?.name === 'string' && err.name.toLowerCase() === 'syntaxerror')

  if (!isSyntaxError || !bufferedText) return false

  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : ''

  const truncationIndicators = [
    'unexpected end of json input',
    'unexpected end of input',
    'unexpected end of string',
    'unexpected eof',
    'end of file',
    'unterminated string',
    'unterminated string constant'
  ]

  if (!truncationIndicators.some((i) => message.includes(i))) return false
  return bufferedText.length >= MIN_TRUNCATION_LENGTH
}

function isAbortError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown }
    if (typeof e.name === 'string' && e.name === 'AbortError') return true
    if (typeof e.code === 'string' && e.code.toUpperCase() === 'ABORT_ERR') return true
  }
  return false
}

function filterContentBlocks<T extends BetaContentBlock['type']>(
  content: BetaContentBlock[],
  type: T
): Extract<BetaContentBlock, { type: T }>[] {
  return content.filter((block): block is Extract<BetaContentBlock, { type: T }> => block.type === type)
}

function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
    raw: undefined
  }
}

function convertClaudeCodeUsage(usage: BetaUsage): LanguageModelV3Usage {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite
    },
    outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
    raw: JSON.parse(JSON.stringify(usage)) as JSONObject
  }
}

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 * When `stopReason` is provided it takes priority.
 */
function mapClaudeCodeFinishReason(subtype?: string, stopReason?: string | null): LanguageModelV3FinishReason {
  if (stopReason != null) {
    switch (stopReason) {
      case 'end_turn':
        return { unified: 'stop', raw: 'end_turn' }
      case 'max_tokens':
        return { unified: 'length', raw: 'max_tokens' }
      case 'stop_sequence':
        return { unified: 'stop', raw: 'stop_sequence' }
      case 'tool_use':
        return { unified: 'tool-calls', raw: 'tool_use' }
    }
  }

  const raw = stopReason ?? subtype
  switch (subtype) {
    case 'success':
      return { unified: 'stop', raw }
    case 'error_max_turns':
      return { unified: 'length', raw }
    case 'error_during_execution':
      return { unified: 'error', raw }
    case undefined:
      return { unified: 'stop', raw }
    default:
      return { unified: 'other', raw }
  }
}

/**
 * Converts AI SDK prompt to Claude Code SDK message format.
 */
/**
 * Extract the last user message text from AI SDK prompt.
 *
 * Claude Agent SDK manages its own conversation history via `resume: sessionId`
 * (stored as JSONL in ~/.claude/projects/). We only need to pass the current
 * user message as the prompt — not the full conversation history.
 */
function convertToClaudeCodeMessages(prompt: readonly ModelMessage[]): {
  messagesPrompt: string
  streamingContentParts: SDKUserMessage['message']['content']
} {
  // Find the last user message
  let lastUserText = ''
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i]
    if (msg.role !== 'user') continue

    if (typeof msg.content === 'string') {
      lastUserText = msg.content
    } else {
      lastUserText = msg.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    }
    break
  }

  return {
    messagesPrompt: lastUserText,
    streamingContentParts: [{ type: 'text' as const, text: lastUserText }]
  }
}

/**
 * Creates an async iterable prompt that keeps the input stream open until output completes.
 * Required for streaming input mode (canUseTool, hooks, MCP, images).
 */
function toAsyncIterablePrompt(
  messagesPrompt: string,
  outputStreamEnded: Promise<unknown>,
  sessionId?: string,
  contentParts?: SDKUserMessage['message']['content']
): AsyncIterable<SDKUserMessage> {
  const content: SDKUserMessage['message']['content'] =
    contentParts && contentParts.length > 0 ? contentParts : [{ type: 'text' as const, text: messagesPrompt }]

  const initialMsg: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: sessionId ?? ''
  }

  return {
    async *[Symbol.asyncIterator]() {
      yield initialMsg
      await outputStreamEnded
    }
  }
}

/**
 * Truncates large tool results to prevent stream bloat.
 */
function truncateToolResultForStream(result: unknown, maxSize: number = MAX_TOOL_RESULT_SIZE): unknown {
  if (typeof result === 'string') {
    if (result.length <= maxSize) return result
    return result.slice(0, maxSize) + `\n...[truncated ${result.length - maxSize} chars]`
  }
  if (typeof result !== 'object' || result === null) return result

  if (Array.isArray(result)) {
    let largestIndex = -1
    let largestSize = 0
    for (let i = 0; i < result.length; i++) {
      if (typeof result[i] === 'string' && (result[i] as string).length > largestSize) {
        largestIndex = i
        largestSize = (result[i] as string).length
      }
    }
    if (largestIndex >= 0 && largestSize > maxSize) {
      const cloned = [...result]
      cloned[largestIndex] =
        (result[largestIndex] as string).slice(0, maxSize) + `\n...[truncated ${largestSize - maxSize} chars]`
      return cloned
    }
    return result
  }

  const obj = result as Record<string, unknown>
  let largestKey: string | null = null
  let largestSize = 0
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.length > largestSize) {
      largestKey = key
      largestSize = value.length
    }
  }
  if (largestKey && largestSize > maxSize) {
    return {
      ...obj,
      [largestKey]: (obj[largestKey] as string).slice(0, maxSize) + `\n...[truncated ${largestSize - maxSize} chars]`
    }
  }
  return result
}

// ── Model ID types ──────────────────────────────────────────────────

export type ClaudeCodeModelId = 'opus' | 'sonnet' | 'haiku' | (string & {})

export interface ClaudeCodeLanguageModelOptions {
  id: ClaudeCodeModelId
  settings?: ClaudeCodeSettings
}

// ── LanguageModelV3 Implementation ──────────────────────────────────

export class ClaudeCodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const
  readonly defaultObjectGenerationMode = 'json' as const
  readonly supportsImageUrls = false
  readonly supportedUrls = {}
  readonly supportsStructuredOutputs = true

  readonly modelId: ClaudeCodeModelId
  readonly settings: ClaudeCodeSettings

  private sessionId?: string

  constructor(options: ClaudeCodeLanguageModelOptions) {
    this.modelId = options.id
    this.settings = options.settings ?? {}

    if (!this.modelId || typeof this.modelId !== 'string' || this.modelId.trim() === '') {
      throw new NoSuchModelError({ modelId: this.modelId, modelType: 'languageModel' })
    }
  }

  get provider(): string {
    return 'claude-code'
  }

  private getModel(): string {
    // Prefer ANTHROPIC_MODEL from env (set by buildEnvironment from session config).
    // this.modelId is the AI SDK model ID which may not match the API model name.
    return this.settings.env?.ANTHROPIC_MODEL ?? this.modelId
  }

  // ── Mid-stream message injection ────────────────────────────────

  /**
   * Map an `AsyncIterable<Message>` (follow-up messages from
   * `PendingMessageQueue`, injected via `AiStreamManager.injectMessage`)
   * into the `AsyncIterable<SDKUserMessage>` shape that Claude Agent
   * SDK's `query.streamInput()` expects.
   */
  private async *mapInjectedMessagesToSdk(
    source: NonNullable<ClaudeCodeSettings['injectedMessageSource']>
  ): AsyncIterable<SDKUserMessage> {
    for await (const message of source) {
      const parts = message.data?.parts
      const text = parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text' && 'text' in p)
        .map((p) => p.text)
        .join('\n')
      if (!text) continue
      yield {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: this.sessionId ?? ''
      }
    }
  }

  // ── SDK Options Builder ─────────────────────────────────────────

  private getEffectiveResume(): string | undefined {
    return this.settings.resume ?? this.sessionId
  }

  private createQueryOptions(
    abortController: AbortController,
    responseFormat?: Parameters<LanguageModelV3['doStream']>[0]['responseFormat'],
    stderrCollector?: (data: string) => void,
    effectiveResume?: string
  ): Options {
    // Spread all settings (which are already Omit<Options, managed fields>),
    // then overlay provider-managed fields.
    const {
      // oxlint-disable-next-line no-unused-vars
      maxToolResultSize: _mts,
      // oxlint-disable-next-line no-unused-vars
      injectedMessageSource: _ims,
      // oxlint-disable-next-line no-unused-vars
      approvalEmitter: _approvalEmitter,
      ...settingsRest
    } = this.settings

    const opts: Partial<Options> = {
      ...settingsRest,
      model: this.getModel(),
      abortController,
      resume: effectiveResume ?? this.settings.resume ?? this.sessionId
    }

    // Wrap stderr callback
    const userStderrCallback = this.settings.stderr
    if (stderrCollector || userStderrCallback) {
      opts.stderr = (data: string) => {
        if (stderrCollector) stderrCollector(data)
        if (userStderrCallback) userStderrCallback(data)
      }
    }

    // Native structured outputs (SDK 0.1.45+)
    if (responseFormat?.type === 'json' && responseFormat.schema) {
      opts.outputFormat = {
        type: 'json_schema',
        schema: responseFormat.schema as Record<string, unknown>
      }
    }

    return opts as Options
  }

  // ── Error Handling ──────────────────────────────────────────────

  private handleClaudeCodeError(
    error: unknown,
    messagesPrompt: string,
    collectedStderr?: string
  ): APICallError | LoadAPIKeyError {
    if (isAbortError(error)) throw error

    const isErrorWithMessage = (err: unknown): err is { message?: string } =>
      typeof err === 'object' && err !== null && 'message' in err
    const isErrorWithCode = (err: unknown): err is { code?: string; exitCode?: number; stderr?: string } =>
      typeof err === 'object' && err !== null

    const authErrorPatterns = [
      'not logged in',
      'authentication',
      'unauthorized',
      'auth failed',
      'please login',
      'claude login',
      'claude auth login',
      '/login',
      'invalid api key'
    ]

    const errorMessage = isErrorWithMessage(error) && error.message ? error.message.toLowerCase() : ''
    const exitCode = isErrorWithCode(error) && typeof error.exitCode === 'number' ? error.exitCode : undefined
    const isAuthError = authErrorPatterns.some((p) => errorMessage.includes(p)) || exitCode === 401

    if (isAuthError) {
      return new LoadAPIKeyError({
        message:
          isErrorWithMessage(error) && error.message
            ? error.message
            : 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.'
      })
    }

    const errorCode = isErrorWithCode(error) && typeof error.code === 'string' ? error.code : ''

    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
      return new APICallError({
        message: isErrorWithMessage(error) && error.message ? error.message : 'Request timed out',
        isRetryable: true,
        url: 'claude-code-sdk://command',
        requestBodyValues: { prompt: messagesPrompt.substring(0, 200) },
        data: { code: 'TIMEOUT', promptExcerpt: messagesPrompt.substring(0, 200) }
      })
    }

    const isRetryable = ['ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(errorCode)
    const stderrFromError = isErrorWithCode(error) && typeof error.stderr === 'string' ? error.stderr : undefined
    const stderr = stderrFromError || collectedStderr || undefined

    return new APICallError({
      message: isErrorWithMessage(error) && error.message ? error.message : 'Claude Code SDK error',
      isRetryable,
      url: 'claude-code-sdk://command',
      requestBodyValues: { prompt: messagesPrompt.substring(0, 200) },
      data: {
        code: errorCode || undefined,
        exitCode,
        stderr,
        promptExcerpt: messagesPrompt.substring(0, 200)
      }
    })
  }

  // ── Content Extraction ────────────────────────────────────────

  private extractToolUses(content: BetaContentBlock[]): ToolUseWithParent[] {
    return filterContentBlocks(content, 'tool_use').map((block) => {
      const b = block as BetaToolUseBlock & { parent_tool_use_id?: string | null }
      return {
        type: 'tool_use' as const,
        id: b.id || generateId(),
        name: b.name || UNKNOWN_TOOL_NAME,
        input: b.input,
        parent_tool_use_id: b.parent_tool_use_id ?? null
      }
    })
  }

  private extractToolResults(content: string | BetaContentBlockParam[]): ToolResultWithName[] {
    if (!Array.isArray(content)) return []
    return content
      .filter((b): b is BetaToolResultBlockParam => b.type === 'tool_result')
      .map((b) => ({
        ...b,
        tool_use_id: b.tool_use_id || generateId(),
        name: undefined // BetaToolResultBlockParam has no name; tool name resolved from toolStates
      }))
  }

  // Tool errors are handled via extractToolResults with is_error: true.
  // No separate tool_error content block type exists in the SDK.

  private serializeToolInput(input: unknown): string {
    if (typeof input === 'string') return this.checkInputSize(input)
    if (input === undefined) return ''
    try {
      return this.checkInputSize(JSON.stringify(input))
    } catch {
      return this.checkInputSize(String(input))
    }
  }

  private checkInputSize(str: string): string {
    if (str.length > MAX_TOOL_INPUT_SIZE) {
      throw new Error(`Tool input exceeds maximum size of ${MAX_TOOL_INPUT_SIZE} bytes (got ${str.length} bytes).`)
    }
    if (str.length > MAX_TOOL_INPUT_WARN) {
      logger.warn(`Large tool input detected: ${str.length} bytes. Performance may be impacted.`)
    }
    return str
  }

  private normalizeToolResult(result: BetaToolResultBlockParam['content']): NonNullable<JSONValue> {
    if (typeof result === 'string') {
      try {
        return JSON.parse(result)
      } catch {
        return result
      }
    }
    if (Array.isArray(result) && result.length > 0) {
      const textBlocks = result
        .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)

      if (textBlocks.length !== result.length) return JSON.parse(JSON.stringify(result))
      const combined = textBlocks.join('\n')
      try {
        return JSON.parse(combined)
      } catch {
        return combined
      }
    }
    return typeof result === 'object' && result !== null ? JSON.parse(JSON.stringify(result)) : String(result ?? '')
  }

  // ── Warnings ──────────────────────────────────────────────────

  private generateAllWarnings(options: Parameters<LanguageModelV3['doStream']>[0]): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = []
    const unsupportedParams: string[] = []

    if (options.temperature !== undefined) unsupportedParams.push('temperature')
    if (options.topP !== undefined) unsupportedParams.push('topP')
    if (options.topK !== undefined) unsupportedParams.push('topK')
    if (options.presencePenalty !== undefined) unsupportedParams.push('presencePenalty')
    if (options.frequencyPenalty !== undefined) unsupportedParams.push('frequencyPenalty')
    if (options.stopSequences !== undefined && options.stopSequences.length > 0) unsupportedParams.push('stopSequences')
    if (options.seed !== undefined) unsupportedParams.push('seed')

    for (const param of unsupportedParams) {
      warnings.push({
        type: 'unsupported',
        feature: param,
        details: `Claude Code SDK does not support the ${param} parameter. It will be ignored.`
      })
    }

    if (options.responseFormat?.type === 'json' && !options.responseFormat.schema) {
      warnings.push({
        type: 'unsupported',
        feature: 'responseFormat',
        details: 'JSON response format requires a schema for the Claude Code provider.'
      })
    }

    return warnings
  }

  // ── MCP Logging ───────────────────────────────────────────────

  private logMcpConnectionIssues(
    mcpServers: Array<{ name?: string; status?: string; error?: string }> | undefined
  ): void {
    if (!Array.isArray(mcpServers) || mcpServers.length === 0) return

    const needsAttention = mcpServers.filter((s) => {
      const status = typeof s.status === 'string' ? s.status.toLowerCase() : ''
      return status === 'failed' || status === 'needs-auth'
    })
    if (needsAttention.length === 0) return

    const details = needsAttention
      .map((s) => {
        const name = typeof s.name === 'string' && s.name.trim() ? s.name : '<unknown>'
        const status = typeof s.status === 'string' && s.status.trim() ? s.status : 'unknown'
        const error = typeof s.error === 'string' && s.error.trim() ? ` (${s.error})` : ''
        return `${name}:${status}${error}`
      })
      .join(', ')
    logger.warn(`MCP servers not connected: ${details}`)
  }

  private setSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  // ── doGenerate (not supported — Cherry Studio uses streaming only) ──

  async doGenerate(
    _options: Parameters<LanguageModelV3['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    throw new Error('Claude Code provider does not support doGenerate. Use doStream instead.')
  }

  // ── doStream ──────────────────────────────────────────────────

  async doStream(
    options: Parameters<LanguageModelV3['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    logger.debug(`Starting doStream with model: ${this.modelId}`)

    const { messagesPrompt, streamingContentParts } = convertToClaudeCodeMessages(options.prompt)

    const abortController = new AbortController()
    let abortListener: (() => void) | undefined
    if (options.abortSignal?.aborted) {
      abortController.abort(options.abortSignal.reason)
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason)
      options.abortSignal.addEventListener('abort', abortListener, { once: true })
    }

    let collectedStderr = ''
    const stderrCollector = (data: string) => {
      collectedStderr += data
    }

    const effectiveResume = this.getEffectiveResume()
    const queryOptions = this.createQueryOptions(
      abortController,
      options.responseFormat,
      stderrCollector,
      effectiveResume
    )

    // Enable partial messages for true streaming (token-by-token delivery)
    if (queryOptions.includePartialMessages === undefined) {
      queryOptions.includePartialMessages = true
    }

    const warnings: SharedV3Warning[] = this.generateAllWarnings(options)

    // Streaming input mode when canUseTool is provided (interactive tool approval requires it)
    const wantsStreamInput = !!this.settings.canUseTool

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        let done = () => {}
        const outputStreamEnded = new Promise((resolve) => {
          done = () => resolve(undefined)
        })

        const ctx: StreamContext = {
          controller,
          options,
          toolStates: new Map(),
          activeTaskTools: new Map(),
          toolBlocksByIndex: new Map(),
          toolInputAccumulators: new Map(),
          textBlocksByIndex: new Map(),
          reasoningBlocksByIndex: new Map(),
          currentReasoningPartId: undefined,
          textPartId: undefined,
          accumulatedText: '',
          streamedTextLength: 0,
          usage: createEmptyUsage(),
          hasReceivedStreamEvents: false,
          hasStreamedJson: false,
          textStreamedViaContentBlock: false,
          warnings: []
        }

        // Wire the approval-emitter holder (if present) so canUseTool can
        // inject `tool-approval-request` parts into this stream. Reset in
        // finally to prevent use-after-close.
        const approvalEmitter = this.settings.approvalEmitter
        if (approvalEmitter) {
          approvalEmitter.emit = (event) => controller.enqueue(event)
        }

        try {
          controller.enqueue({ type: 'stream-start', warnings })

          if (this.settings.canUseTool && this.settings.permissionPromptToolName) {
            throw new Error(
              'canUseTool requires streaming input mode and cannot be used with permissionPromptToolName. Remove permissionPromptToolName, or remove canUseTool.'
            )
          }

          const sdkPrompt = wantsStreamInput
            ? toAsyncIterablePrompt(messagesPrompt, outputStreamEnded, effectiveResume, streamingContentParts)
            : messagesPrompt

          logger.debug(
            `Starting stream query, streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? 'new'}`
          )

          const response = query({ prompt: sdkPrompt, options: queryOptions })

          // Pipe injected follow-up messages into the SDK's streamInput for mid-turn injection
          if (this.settings.injectedMessageSource) {
            void response.streamInput(this.mapInjectedMessagesToSdk(this.settings.injectedMessageSource))
          }

          for await (const message of response) {
            switch (message.type) {
              case 'stream_event':
                this.handleStreamEvent(message, ctx)
                break
              case 'assistant':
                this.handleAssistantMessage(message, ctx)
                break
              case 'user':
                this.handleUserMessage(message, ctx)
                break
              case 'result':
                this.handleResultMessage(message, ctx, done)
                return
              case 'system':
                this.handleSystemMessage(message, ctx)
                break
              default:
                // Pass through all other SDK message types as raw events
                // (api_retry, compact_boundary, status, task_notification,
                //  task_progress, tool_progress, rate_limit_event, prompt_suggestion, etc.)
                ctx.controller.enqueue({ type: 'raw', rawValue: message })
                break
            }
          }

          this.finalizeToolCalls(ctx)
          controller.close()
        } catch (error: unknown) {
          done()

          if (isClaudeCodeTruncationError(error, ctx.accumulatedText)) {
            this.handleTruncationError(ctx)
            return
          }

          this.finalizeToolCalls(ctx)
          let errorToEmit: unknown
          if (isAbortError(error)) {
            errorToEmit = options.abortSignal?.aborted ? options.abortSignal.reason : error
          } else {
            errorToEmit = this.handleClaudeCodeError(error, messagesPrompt, collectedStderr)
          }

          controller.enqueue({ type: 'error', error: errorToEmit })
          controller.close()
        } finally {
          if (options.abortSignal && abortListener) {
            options.abortSignal.removeEventListener('abort', abortListener)
          }
          if (approvalEmitter) {
            approvalEmitter.emit = undefined
            approvalEmitter.dispose?.()
          }
        }
      },
      cancel: () => {
        if (options.abortSignal && abortListener) {
          options.abortSignal.removeEventListener('abort', abortListener)
        }
      }
    })

    return {
      stream,
      request: { body: messagesPrompt }
    }
  }

  // ── Stream Message Handlers ──────────────────────────────────

  private handleStreamEvent(message: SDKPartialAssistantMessage, ctx: StreamContext): void {
    const { event } = message
    switch (event.type) {
      case 'content_block_start':
        this.handleContentBlockStart(event, ctx)
        break
      case 'content_block_delta':
        this.handleContentBlockDelta(event, ctx)
        break
      case 'content_block_stop':
        this.handleContentBlockStop(event, ctx)
        break
      case 'message_delta':
        this.handleMessageDelta(event, ctx)
        break
      case 'message_start':
      case 'message_stop':
        break
    }
  }

  // ── content_block_start handlers ─────────────────────────────

  private handleContentBlockStart(event: BetaRawContentBlockStartEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
    switch (event.content_block.type) {
      case 'tool_use':
        this.handleToolUseBlockStart(event, ctx)
        break
      case 'text':
        this.handleTextBlockStart(event, ctx)
        break
      case 'thinking':
        this.handleThinkingBlockStart(event, ctx)
        break
      // Ignore server_tool_use, web_search_tool_result, redacted_thinking
    }
  }

  private handleToolUseBlockStart(event: BetaRawContentBlockStartEvent, ctx: StreamContext): void {
    const toolBlock = event.content_block as BetaToolUseBlock
    const toolId = toolBlock.id || generateId()
    const toolName = toolBlock.name || UNKNOWN_TOOL_NAME

    this.closeActiveTextPart(ctx)

    ctx.toolBlocksByIndex.set(event.index, toolId)
    ctx.toolInputAccumulators.set(toolId, '')

    let state = ctx.toolStates.get(toolId)
    if (!state) {
      const currentParentId = toolName === 'Task' ? null : this.getFallbackParentId(ctx)
      state = {
        name: toolName,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: currentParentId
      }
      ctx.toolStates.set(toolId, state)
    }

    if (!state.inputStarted) {
      ctx.controller.enqueue({
        type: 'tool-input-start',
        id: toolId,
        toolName,
        providerExecuted: true,
        dynamic: true,
        providerMetadata: { 'claude-code': { parentToolCallId: state.parentToolCallId ?? null } }
      })
      if (toolName === 'Task') ctx.activeTaskTools.set(toolId, { startTime: Date.now() })
      state.inputStarted = true
    }
  }

  private handleTextBlockStart(event: BetaRawContentBlockStartEvent, ctx: StreamContext): void {
    const partId = generateId()
    ctx.textBlocksByIndex.set(event.index, partId)
    ctx.textPartId = partId
    ctx.controller.enqueue({ type: 'text-start', id: partId })
    ctx.textStreamedViaContentBlock = true
  }

  private handleThinkingBlockStart(event: BetaRawContentBlockStartEvent, ctx: StreamContext): void {
    this.closeActiveTextPart(ctx)

    const reasoningPartId = generateId()
    ctx.reasoningBlocksByIndex.set(event.index, reasoningPartId)
    ctx.currentReasoningPartId = reasoningPartId
    ctx.controller.enqueue({ type: 'reasoning-start', id: reasoningPartId })
  }

  // ── content_block_delta handlers ─────────────────────────────

  private handleContentBlockDelta(event: BetaRawContentBlockDeltaEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
    switch (event.delta.type) {
      case 'text_delta':
        this.handleTextDelta(event.delta.text, ctx)
        break
      case 'input_json_delta':
        this.handleInputJsonDelta(event.delta.partial_json, event.index, ctx)
        break
      case 'thinking_delta':
        this.handleThinkingDelta(event.delta.thinking, event.index, ctx)
        break
      case 'signature_delta':
      case 'citations_delta':
        break
    }
  }

  private handleTextDelta(text: string, ctx: StreamContext): void {
    if (!text) return

    if (ctx.options.responseFormat?.type === 'json') {
      ctx.accumulatedText += text
      ctx.streamedTextLength += text.length
      return
    }

    if (!ctx.textPartId) {
      ctx.textPartId = generateId()
      ctx.controller.enqueue({ type: 'text-start', id: ctx.textPartId })
    }
    ctx.controller.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
    ctx.accumulatedText += text
    ctx.streamedTextLength += text.length
  }

  private handleInputJsonDelta(partialJson: string, blockIndex: number, ctx: StreamContext): void {
    if (!partialJson) return

    if (ctx.options.responseFormat?.type === 'json') {
      if (!ctx.textPartId) {
        ctx.textPartId = generateId()
        ctx.controller.enqueue({ type: 'text-start', id: ctx.textPartId })
      }
      ctx.controller.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: partialJson })
      ctx.accumulatedText += partialJson
      ctx.streamedTextLength += partialJson.length
      ctx.hasStreamedJson = true
      return
    }

    const toolId = ctx.toolBlocksByIndex.get(blockIndex)
    if (toolId) {
      const accumulated = (ctx.toolInputAccumulators.get(toolId) ?? '') + partialJson
      ctx.toolInputAccumulators.set(toolId, accumulated)
      ctx.controller.enqueue({ type: 'tool-input-delta', id: toolId, delta: partialJson })
    }
  }

  private handleThinkingDelta(thinking: string, blockIndex: number, ctx: StreamContext): void {
    if (!thinking) return
    const reasoningPartId = ctx.reasoningBlocksByIndex.get(blockIndex) ?? ctx.currentReasoningPartId
    if (reasoningPartId) {
      ctx.controller.enqueue({ type: 'reasoning-delta', id: reasoningPartId, delta: thinking })
    }
  }

  // ── content_block_stop handler ───────────────────────────────

  private handleContentBlockStop(event: BetaRawContentBlockStopEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
    const blockIndex = event.index

    // Tool block stop
    const toolId = ctx.toolBlocksByIndex.get(blockIndex)
    if (toolId) {
      this.handleToolBlockStop(toolId, blockIndex, ctx)
      return
    }

    // Text block stop
    const textId = ctx.textBlocksByIndex.get(blockIndex)
    if (textId) {
      ctx.controller.enqueue({ type: 'text-end', id: textId })
      ctx.textBlocksByIndex.delete(blockIndex)
      if (ctx.textPartId === textId) ctx.textPartId = undefined
      return
    }

    // Reasoning block stop
    const reasoningPartId = ctx.reasoningBlocksByIndex.get(blockIndex)
    if (reasoningPartId) {
      ctx.controller.enqueue({ type: 'reasoning-end', id: reasoningPartId })
      ctx.reasoningBlocksByIndex.delete(blockIndex)
      if (ctx.currentReasoningPartId === reasoningPartId) ctx.currentReasoningPartId = undefined
    }
  }

  private handleToolBlockStop(toolId: string, blockIndex: number, ctx: StreamContext): void {
    const state = ctx.toolStates.get(toolId)
    if (state && !state.inputClosed) {
      const accumulatedInput = ctx.toolInputAccumulators.get(toolId) ?? ''
      ctx.controller.enqueue({ type: 'tool-input-end', id: toolId })
      state.inputClosed = true
      const effectiveInput = accumulatedInput || state.lastSerializedInput || ''
      state.lastSerializedInput = effectiveInput

      if (!state.callEmitted) {
        ctx.controller.enqueue({
          type: 'tool-call',
          toolCallId: toolId,
          toolName: state.name,
          input: effectiveInput,
          providerExecuted: true,
          dynamic: true,
          providerMetadata: {
            'claude-code': { rawInput: effectiveInput, parentToolCallId: state.parentToolCallId ?? null }
          }
        })
        state.callEmitted = true
      }
    }
    ctx.toolBlocksByIndex.delete(blockIndex)
    ctx.toolInputAccumulators.delete(toolId)
  }

  // ── message_delta handler ────────────────────────────────────

  private handleMessageDelta(_event: BetaRawMessageDeltaEvent, ctx: StreamContext): void {
    // Usage from message_delta is superseded by the result message's usage.
    // Stop reason is handled via the result message as well.
    // We only mark that we received stream events.
    ctx.hasReceivedStreamEvents = true
  }

  // ── assistant message handler ────────────────────────────────

  private handleAssistantMessage(message: SDKAssistantMessage, ctx: StreamContext): void {
    if (!message.message?.content) return

    const sdkParentToolUseId = message.parent_tool_use_id
    const content = message.message.content
    const tools = this.extractToolUses(content)

    if (ctx.textPartId && tools.length > 0) {
      this.closeActiveTextPart(ctx)
    }

    for (const tool of tools) {
      this.handleAssistantToolUse(tool, sdkParentToolUseId, ctx)
    }

    // Handle text from assistant message
    const text = content.map((c: BetaContentBlock) => (c.type === 'text' ? c.text : '')).join('')

    if (text) {
      this.handleAssistantText(text, ctx)
    }
  }

  private handleAssistantToolUse(tool: ToolUseWithParent, sdkParentToolUseId: string | null, ctx: StreamContext): void {
    const toolId = tool.id
    let state = ctx.toolStates.get(toolId)
    if (!state) {
      const currentParentId =
        tool.name === 'Task' ? null : (sdkParentToolUseId ?? tool.parent_tool_use_id ?? this.getFallbackParentId(ctx))
      state = {
        name: tool.name,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: currentParentId
      }
      ctx.toolStates.set(toolId, state)
    } else if (!state.parentToolCallId && sdkParentToolUseId && tool.name !== 'Task') {
      state.parentToolCallId = sdkParentToolUseId
    }
    state.name = tool.name

    if (!state.inputStarted) {
      ctx.controller.enqueue({
        type: 'tool-input-start',
        id: toolId,
        toolName: tool.name,
        providerExecuted: true,
        dynamic: true,
        providerMetadata: { 'claude-code': { parentToolCallId: state.parentToolCallId ?? null } }
      })
      if (tool.name === 'Task') ctx.activeTaskTools.set(toolId, { startTime: Date.now() })
      state.inputStarted = true
    }

    const serializedInput = this.serializeToolInput(tool.input)
    if (serializedInput) {
      let deltaPayload = ''
      if (state.lastSerializedInput === undefined) {
        if (serializedInput.length <= MAX_DELTA_CALC_SIZE) deltaPayload = serializedInput
      } else if (
        serializedInput.length <= MAX_DELTA_CALC_SIZE &&
        state.lastSerializedInput.length <= MAX_DELTA_CALC_SIZE &&
        serializedInput.startsWith(state.lastSerializedInput)
      ) {
        deltaPayload = serializedInput.slice(state.lastSerializedInput.length)
      } else if (serializedInput !== state.lastSerializedInput) {
        // Non-prefix update or large input — defer to final tool-call payload
        deltaPayload = ''
      }
      if (deltaPayload) {
        ctx.controller.enqueue({ type: 'tool-input-delta', id: toolId, delta: deltaPayload })
      }
      state.lastSerializedInput = serializedInput
    }
  }

  private handleAssistantText(text: string, ctx: StreamContext): void {
    if (ctx.hasReceivedStreamEvents) {
      const newTextStart = ctx.streamedTextLength
      const deltaText = text.length > newTextStart ? text.slice(newTextStart) : ''
      ctx.accumulatedText = text

      if (ctx.options.responseFormat?.type !== 'json' && deltaText) {
        if (!ctx.textPartId) {
          ctx.textPartId = generateId()
          ctx.controller.enqueue({ type: 'text-start', id: ctx.textPartId })
        }
        ctx.controller.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: deltaText })
      }
      ctx.streamedTextLength = text.length
    } else {
      ctx.accumulatedText += text
      if (ctx.options.responseFormat?.type !== 'json') {
        if (!ctx.textPartId) {
          ctx.textPartId = generateId()
          ctx.controller.enqueue({ type: 'text-start', id: ctx.textPartId })
        }
        ctx.controller.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
      }
    }
  }

  // ── user message handler (tool results) ──────────────────────

  private handleUserMessage(message: SDKUserMessage, ctx: StreamContext): void {
    if (!message.message?.content) return

    // Reset text state between assistant messages
    if (ctx.textPartId) {
      this.closeActiveTextPart(ctx)
      ctx.accumulatedText = ''
      ctx.streamedTextLength = 0
    }

    const sdkParentToolUseId = message.parent_tool_use_id
    const content = message.message.content

    for (const result of this.extractToolResults(content)) {
      this.handleToolResult(result, sdkParentToolUseId, ctx)
    }
    // Tool errors are handled via extractToolResults with is_error: true
    // — no separate tool_error content block type in the SDK.
  }

  private handleToolResult(result: ToolResultWithName, sdkParentToolUseId: string | null, ctx: StreamContext): void {
    let state = ctx.toolStates.get(result.tool_use_id)
    const toolName = result.name ?? state?.name ?? UNKNOWN_TOOL_NAME

    if (!state) {
      const resolvedParentId = toolName === 'Task' ? null : (sdkParentToolUseId ?? this.getFallbackParentId(ctx))
      state = {
        name: toolName,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: resolvedParentId
      }
      ctx.toolStates.set(result.tool_use_id, state)
      if (!state.inputStarted) {
        ctx.controller.enqueue({
          type: 'tool-input-start',
          id: result.tool_use_id,
          toolName,
          providerExecuted: true,
          dynamic: true,
          providerMetadata: { 'claude-code': { parentToolCallId: state.parentToolCallId ?? null } }
        })
        state.inputStarted = true
      }
      if (!state.inputClosed) {
        ctx.controller.enqueue({ type: 'tool-input-end', id: result.tool_use_id })
        state.inputClosed = true
      }
    }
    state.name = toolName

    const normalizedResult = this.normalizeToolResult(result.content)
    const rawResult =
      typeof result.content === 'string'
        ? result.content
        : (() => {
            try {
              return JSON.stringify(result.content)
            } catch {
              return String(result.content)
            }
          })()

    const maxToolResultSize = this.settings.maxToolResultSize
    const truncatedResult = truncateToolResultForStream(normalizedResult, maxToolResultSize) as NonNullable<JSONValue>
    const truncatedRawResult = truncateToolResultForStream(rawResult, maxToolResultSize) as string
    const rawResultTruncated = truncatedRawResult !== rawResult

    this.emitToolCall(result.tool_use_id, state, ctx)
    if (toolName === 'Task') ctx.activeTaskTools.delete(result.tool_use_id)

    ctx.controller.enqueue({
      type: 'tool-result',
      toolCallId: result.tool_use_id,
      toolName,
      result: truncatedResult,
      isError: result.is_error,
      dynamic: true,
      providerMetadata: {
        'claude-code': {
          rawResult: truncatedRawResult,
          rawResultTruncated,
          parentToolCallId: state.parentToolCallId ?? null
        }
      }
    })
  }

  // ── result message handler ───────────────────────────────────

  private handleResultMessage(message: SDKResultMessage, ctx: StreamContext, done: () => void): void {
    done()

    logger.info(
      `Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? 'N/A'}, Duration: ${message.duration_ms ?? 'N/A'}ms`
    )

    ctx.usage = convertClaudeCodeUsage(message.usage)
    const finishReason = mapClaudeCodeFinishReason(message.subtype, message.stop_reason)
    this.setSessionId(message.session_id)

    // Handle error results (SDKResultError)
    if (message.subtype !== 'success') {
      // After narrowing: message is SDKResultError which has `errors: string[]`
      const errorMsg = message.errors.join('; ') || `Claude Code error: ${message.subtype}`
      throw Object.assign(new Error(errorMsg), { exitCode: 1, subtype: message.subtype })
    }

    // SDKResultSuccess — after narrowing: message is SDKResultSuccess
    const structuredOutput = message.structured_output
    const alreadyStreamedJson =
      ctx.hasStreamedJson && ctx.options.responseFormat?.type === 'json' && ctx.hasReceivedStreamEvents

    if (alreadyStreamedJson) {
      if (ctx.textPartId) ctx.controller.enqueue({ type: 'text-end', id: ctx.textPartId })
    } else if (structuredOutput !== undefined) {
      const jsonTextId = generateId()
      const jsonText = JSON.stringify(structuredOutput)
      ctx.controller.enqueue({ type: 'text-start', id: jsonTextId })
      ctx.controller.enqueue({ type: 'text-delta', id: jsonTextId, delta: jsonText })
      ctx.controller.enqueue({ type: 'text-end', id: jsonTextId })
    } else if (ctx.textPartId) {
      ctx.controller.enqueue({ type: 'text-end', id: ctx.textPartId })
    } else if (ctx.accumulatedText && !ctx.textStreamedViaContentBlock) {
      const fallbackTextId = generateId()
      ctx.controller.enqueue({ type: 'text-start', id: fallbackTextId })
      ctx.controller.enqueue({ type: 'text-delta', id: fallbackTextId, delta: ctx.accumulatedText })
      ctx.controller.enqueue({ type: 'text-end', id: fallbackTextId })
    }

    this.finalizeToolCalls(ctx)

    const warningsJson = this.serializeWarningsForMetadata(ctx.warnings)
    ctx.controller.enqueue({
      type: 'finish',
      finishReason,
      usage: ctx.usage,
      providerMetadata: {
        'claude-code': {
          sessionId: message.session_id,
          ...(message.total_cost_usd !== undefined && { costUsd: message.total_cost_usd }),
          ...(message.duration_ms !== undefined && { durationMs: message.duration_ms }),
          ...(message.modelUsage !== undefined && { modelUsage: message.modelUsage }),
          ...(ctx.warnings.length > 0 && { warnings: warningsJson })
        }
      }
    })
    ctx.controller.close()
  }

  // ── system message handler ───────────────────────────────────

  private handleSystemMessage(
    message: { type: 'system'; subtype: string; session_id: string; [key: string]: unknown },
    ctx: StreamContext
  ): void {
    if (message.subtype !== 'init') return

    const initMessage = message as SDKSystemMessage
    this.logMcpConnectionIssues(initMessage.mcp_servers)
    this.setSessionId(initMessage.session_id)
    logger.info(`Stream session initialized: ${initMessage.session_id}`)

    ctx.controller.enqueue({
      type: 'response-metadata',
      id: initMessage.session_id,
      timestamp: new Date(),
      modelId: this.modelId
    })
  }

  // ── Shared Stream Utilities ──────────────────────────────────

  private getFallbackParentId(ctx: StreamContext): string | null {
    if (ctx.activeTaskTools.size === 1) {
      return ctx.activeTaskTools.keys().next().value ?? null
    }
    return null
  }

  private closeActiveTextPart(ctx: StreamContext): void {
    if (!ctx.textPartId) return
    const closedTextId = ctx.textPartId
    ctx.controller.enqueue({ type: 'text-end', id: closedTextId })
    ctx.textPartId = undefined
    for (const [idx, blockTextId] of ctx.textBlocksByIndex) {
      if (blockTextId === closedTextId) {
        ctx.textBlocksByIndex.delete(idx)
        break
      }
    }
  }

  private emitToolCall(toolId: string, state: ToolStreamState, ctx: StreamContext): void {
    if (state.callEmitted) return
    if (!state.inputClosed && state.inputStarted) {
      ctx.controller.enqueue({ type: 'tool-input-end', id: toolId })
      state.inputClosed = true
    }
    ctx.controller.enqueue({
      type: 'tool-call',
      toolCallId: toolId,
      toolName: state.name,
      input: state.lastSerializedInput ?? '',
      providerExecuted: true,
      dynamic: true,
      providerMetadata: {
        'claude-code': { rawInput: state.lastSerializedInput ?? '', parentToolCallId: state.parentToolCallId ?? null }
      }
    })
    state.callEmitted = true
  }

  private finalizeToolCalls(ctx: StreamContext): void {
    for (const [toolId, state] of ctx.toolStates) {
      this.emitToolCall(toolId, state, ctx)
    }
    ctx.toolStates.clear()
  }

  private handleTruncationError(ctx: StreamContext): void {
    logger.warn(`Detected truncated stream response, returning ${ctx.accumulatedText.length} chars of buffered text`)
    const truncationWarning: SharedV3Warning = { type: 'other', message: CLAUDE_CODE_TRUNCATION_WARNING }
    ctx.warnings.push(truncationWarning)

    if (ctx.textPartId) {
      ctx.controller.enqueue({ type: 'text-end', id: ctx.textPartId })
    } else if (ctx.accumulatedText && !ctx.textStreamedViaContentBlock) {
      const fallbackTextId = generateId()
      ctx.controller.enqueue({ type: 'text-start', id: fallbackTextId })
      ctx.controller.enqueue({ type: 'text-delta', id: fallbackTextId, delta: ctx.accumulatedText })
      ctx.controller.enqueue({ type: 'text-end', id: fallbackTextId })
    }

    this.finalizeToolCalls(ctx)
    const warningsJson = this.serializeWarningsForMetadata(ctx.warnings)
    ctx.controller.enqueue({
      type: 'finish',
      finishReason: { unified: 'length', raw: 'truncation' },
      usage: ctx.usage,
      providerMetadata: {
        'claude-code': {
          ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
          truncated: true,
          ...(ctx.warnings.length > 0 && { warnings: warningsJson as unknown as JSONValue })
        }
      }
    })
    ctx.controller.close()
  }

  private serializeWarningsForMetadata(warnings: SharedV3Warning[]): JSONValue {
    return warnings.map((w) => {
      const base: Record<string, string> = { type: w.type }
      if ('message' in w) {
        const m = (w as { message?: unknown }).message
        if (m !== undefined) base.message = String(m)
      }
      if (w.type === 'unsupported' || w.type === 'compatibility') {
        const feature = (w as { feature: unknown }).feature
        if (feature !== undefined) base.feature = String(feature)
        if ('details' in w) {
          const d = (w as { details?: unknown }).details
          if (d !== undefined) base.details = String(d)
        }
      }
      return base
    }) as unknown as JSONValue
  }
}
