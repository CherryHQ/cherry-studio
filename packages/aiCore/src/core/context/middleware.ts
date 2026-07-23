/**
 * Context middleware: transparently truncates oversized tool results and
 * enforces the token budget on every AI SDK model call, via a
 * `LanguageModelMiddleware` wired into the plugin chain.
 *
 * Vendored from @context-chef/ai-sdk-middleware 1.6.0 (MIT, same author),
 * trimmed to the options Cherry Studio uses: `contextWindow`, `compact`,
 * `truncate`, `onBeforeCompress`, `logger`. In-flight LLM compression
 * (`compress`/`onCompress`), skills, dynamic state, placeholder clearing and
 * custom tokenizers were dropped — LLM summarization is owned by the durable
 * (`summarizeModelMessages`) and in-loop (`compactModelMessages`) paths.
 */
import type { LanguageModelV3Message, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { generateText, type LanguageModel, type LanguageModelMiddleware, type ModelMessage, pruneMessages } from 'ai'

import { fromAISDK, toAISDK } from './adapter'
import { Janitor, summarizeHistory, type SummarizeHistoryOptions } from './janitor'
import { fromModelMessages } from './modelMessageAdapter'
import { type TruncateOptions, truncateToolResults } from './truncator'
import type { ContextLogger, ContextMessage } from './types'

type CompressRole = 'system' | 'user' | 'assistant'

/**
 * After this many budget compressions fire, warn once. The middleware
 * compresses in-flight only — it never mutates the caller's message store —
 * so without durable write-back the history re-expands every call and the
 * outgoing payload grows unbounded. A couple of fires is a transient spike
 * (fine); repeated fires signal a sustained over-budget conversation that
 * needs durable compaction.
 */
const COMPRESS_WITHOUT_PERSISTENCE_WARN_THRESHOLD = 3

/**
 * Mechanical compaction options — zero LLM cost.
 * Delegates to AI SDK's `pruneMessages` before IR conversion.
 */
export interface CompactConfig {
  /**
   * Controls removal of reasoning content from assistant messages.
   * - `'all'`: Remove reasoning from all messages.
   * - `'before-last-message'`: Keep reasoning only in the final message.
   * - `'none'` (default): Keep all reasoning.
   */
  reasoning?: 'all' | 'before-last-message' | 'none'
  /**
   * Controls removal of tool-call, tool-result, and tool-approval chunks.
   */
  toolCalls?:
    | 'all'
    | 'before-last-message'
    | `before-last-${number}-messages`
    | 'none'
    | Array<{
        type: 'all' | 'before-last-message' | `before-last-${number}-messages`
        tools?: string[]
      }>
  /**
   * Whether to retain messages with no content after pruning.
   * - `'remove'` (default): Exclude empty messages.
   * - `'keep'`: Retain them.
   */
  emptyMessages?: 'keep' | 'remove'
}

export interface ContextMiddlewareOptions {
  /**
   * The model's context window size in tokens.
   *
   * Required when `onBeforeCompress` is configured — `createContextMiddleware`
   * throws otherwise. Optional (and unused) for truncate / compact-only
   * configurations, which involve no budget check.
   */
  contextWindow?: number
  /** Enable tool result truncation. Omit for no truncation. */
  truncate?: TruncateOptions
  /**
   * Mechanical compaction via AI SDK's `pruneMessages`.
   * Prunes reasoning, tool calls, and empty messages at zero LLM cost.
   */
  compact?: CompactConfig
  /**
   * Called when the token budget is exceeded. Return modified messages to
   * replace history (re-evaluated against the budget), or null/undefined to
   * let the mechanical keep-last-turn drop handle it.
   */
  onBeforeCompress?: (
    history: ContextMessage[],
    tokenInfo: { currentTokens: number; limit: number }
  ) => ContextMessage[] | null | undefined | Promise<ContextMessage[] | null | undefined>
  /**
   * Sink for degradation warnings (storage write failures, missing usage
   * data, misconfiguration). Defaults to `console`.
   */
  logger?: ContextLogger
}

/**
 * Creates a LanguageModelMiddleware that transparently applies context
 * truncation and budget compression to AI SDK model calls.
 *
 * The middleware holds a stateful Janitor instance that tracks token usage
 * across calls (steps of the same wrapped model) for compression decisions.
 */
export function createContextMiddleware(options: ContextMiddlewareOptions): LanguageModelMiddleware {
  const logger = options.logger ?? console
  let usageWarned = false

  // Budget-dependent feature: the over-budget hook needs a Janitor — and
  // therefore a `contextWindow`. Truncate/compact-only configurations get no
  // Janitor at all: no budget checks and no token-usage capture.
  const budgeting = Boolean(options.onBeforeCompress)

  if (budgeting && options.contextWindow == null) {
    throw new Error(
      '[context] `contextWindow` is required when `onBeforeCompress` is configured — ' +
        'the budget check has nothing to compare against without it.'
    )
  }

  // Surface the in-flight-without-persistence footgun: if budget compression
  // keeps firing, each call re-expands the history (nothing is persisted), so
  // the payload grows unbounded (and compression effectively skips every
  // other call via E10 suppression).
  let compressionsFired = 0
  let persistenceWarned = false
  const onCompressionFired = () => {
    compressionsFired++
    if (persistenceWarned || compressionsFired < COMPRESS_WITHOUT_PERSISTENCE_WARN_THRESHOLD) {
      return
    }
    persistenceWarned = true
    logger.warn(
      `[context] budget compression has fired ${compressionsFired}× in-flight. In-flight compression ` +
        'only rewrites each outgoing request — nothing is persisted, so the message history re-expands ' +
        'on the next call and the payload grows unbounded (eventually overflowing the context window). ' +
        'For sustained compression, persist a summary durably (compactModelMessages / summarizeModelMessages).'
    )
  }

  const janitor = budgeting
    ? new Janitor({
        contextWindow: options.contextWindow as number,
        // Installed so every compression is counted for the persistence warning.
        onCompress: onCompressionFired,
        onBeforeCompress: options.onBeforeCompress,
        logger
      })
    : null

  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      let { prompt } = params

      // 1. Truncate large tool results
      if (options.truncate) {
        prompt = await truncateToolResults(prompt, options.truncate, logger)
      }

      // 2. Compact (mechanical, zero LLM cost) via pruneMessages
      if (options.compact) {
        prompt = compactPrompt(prompt, options.compact)
      }

      // 3. Convert to IR and separate system messages from conversation.
      // System messages are standing instructions — they must not be
      // compressed away. Only conversation history goes through compression.
      const allIR = fromAISDK(prompt)
      const systemMessages = allIR.filter((m) => m.role === 'system')
      let conversation = allIR.filter((m) => m.role !== 'system')

      // 4. Compress conversation history if over token budget (budgeting only)
      if (janitor) {
        conversation = await janitor.compress(conversation)
      }

      // 5. Reassemble: user system messages, then conversation.
      // 6. Convert back to AI SDK format
      prompt = toAISDK([...systemMessages, ...conversation])

      return { ...params, prompt }
    },

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()

      if (!janitor) return result

      if (result.usage?.inputTokens?.total != null) {
        janitor.feedTokenUsage(result.usage.inputTokens.total)
      } else if (!usageWarned) {
        usageWarned = true
        logger.warn(
          '[context] Model response did not include usage.inputTokens.total. ' +
            'Token-based compression may not trigger accurately.'
        )
      }

      return result
    },

    wrapStream: async ({ doStream }) => {
      if (!janitor) return doStream()

      const { stream, ...rest } = await doStream()

      const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'finish') {
            if (chunk.usage?.inputTokens?.total != null) {
              janitor.feedTokenUsage(chunk.usage.inputTokens.total)
            } else if (!usageWarned) {
              usageWarned = true
              logger.warn(
                '[context] Stream finish did not include usage.inputTokens.total. ' +
                  'Token-based compression may not trigger accurately.'
              )
            }
          }
          controller.enqueue(chunk)
        }
      })

      return { ...rest, stream: stream.pipeThrough(transform) }
    }
  }
}

/**
 * Prunes a LanguageModelV3Prompt via AI SDK's pruneMessages.
 *
 * LanguageModelV3Message (from @ai-sdk/provider) and ModelMessage
 * (from @ai-sdk/provider-utils) share identical runtime structure but
 * differ at the TypeScript level (e.g. ImagePart, FilePart.data).
 * Since pruneMessages only filters — never transforms — every content
 * part in the output is an original V3 part, making the casts safe.
 */
function compactPrompt(
  prompt: LanguageModelV3Prompt,
  config: Omit<Parameters<typeof pruneMessages>[0], 'messages'>
): LanguageModelV3Prompt {
  const messages = prompt.map(
    (msg) =>
      ({
        role: msg.role,
        content: msg.content,
        providerOptions: msg.providerOptions
      }) as ModelMessage
  )
  const pruned = pruneMessages({ messages, ...config })
  return pruned.map(
    (msg) =>
      ({
        role: msg.role,
        content: msg.content,
        providerOptions: msg.providerOptions
      }) as LanguageModelV3Message
  )
}

/**
 * Maps an IR role to a role accepted by generateText.
 * Tool messages are handled separately before this is called.
 */
function toCompressRole(role: string): CompressRole {
  if (role === 'system' || role === 'user' || role === 'assistant') return role
  return 'user'
}

/**
 * Adapts an AI SDK LanguageModelV3 into the compression callback that the
 * summarizer pipeline expects: (messages: ContextMessage[]) => Promise<string>
 *
 * Tool messages are converted to user messages describing the tool interaction,
 * since generateText only accepts system/user/assistant roles.
 */
export function createCompressionAdapter(model: LanguageModel): (messages: ContextMessage[]) => Promise<string> {
  return async (messages: ContextMessage[]): Promise<string> => {
    const formatted = messages.map((m): { role: CompressRole; content: string } => {
      if (m.role === 'tool') {
        return {
          role: 'user' satisfies CompressRole,
          content: `[Tool result${m.tool_call_id ? ` (${m.tool_call_id})` : ''}: ${m.content}]`
        }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const toolCallsDesc = m.tool_calls
          .map((tc) => `[Called tool: ${tc.function.name}(${tc.function.arguments})]`)
          .join('\n')
        return {
          role: 'assistant' satisfies CompressRole,
          content: m.content ? `${m.content}\n${toolCallsDesc}` : toolCallsDesc
        }
      }
      return {
        role: toCompressRole(m.role),
        content: m.content
      }
    })

    const { text } = await generateText({
      model,
      messages: formatted,
      maxOutputTokens: 2048
    })

    return text || '[Compression produced no output]'
  }
}

/**
 * Options for {@link summarizeModelMessages}. Currently a structural alias of
 * `SummarizeHistoryOptions` — add middleware-specific fields here if they ever
 * diverge.
 */
export type SummarizeMessagesOptions = SummarizeHistoryOptions

/**
 * Summarize a `ModelMessage[]` slice into a single summary string, using the
 * SAME pipeline as budget compression: role-flattening via the compression
 * adapter + `summarizeHistory`. System messages are dropped (they are
 * standing instructions, not conversation). Returns the extracted summary
 * text — wrap it with `ContextPrompts.getCompactSummaryWrapper` for the
 * "continued conversation" framing. An empty input returns `''` without a
 * model call; throws if the model call fails.
 *
 * For hosts that own their conversation store and persist compression
 * themselves (durable compaction) instead of relying on in-flight middleware
 * compression.
 */
export async function summarizeModelMessages(
  messages: ModelMessage[],
  model: LanguageModel,
  opts: SummarizeMessagesOptions = {}
): Promise<string> {
  const ir = fromModelMessages(messages).filter((m) => m.role !== 'system')
  return summarizeHistory(ir, createCompressionAdapter(model), opts)
}
