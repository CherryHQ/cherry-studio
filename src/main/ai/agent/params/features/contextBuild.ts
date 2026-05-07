/**
 * Context-build feature: wires context-management middleware into the
 * AI SDK plugin chain.
 *
 * Today the implementation delegates to `@context-chef/ai-sdk-middleware`'s
 * `createMiddleware`, which pushes a `LanguageModelMiddleware` that:
 *
 *   1. truncates oversized tool results, offloading the full content via
 *      `VfsBlobService` (model sees head + tail + `context://vfs/...` URI)
 *   2. mechanically prunes reasoning blocks / empty messages (zero LLM cost)
 *   3. (opt-in) compresses history with a user-chosen cheap model when
 *      the context window fills
 *   4. injects per-iteration runtime state (tool-approval activity, …)
 *      as a system message via `dynamicState`
 *
 * The feature name is intentionally library-agnostic — chef is the
 * implementation, but the *role* is "build / shape the context the model
 * sees on each call". A future swap of the backing library would not
 * require renaming this feature or its settings field.
 *
 * Gated on `scope.contextSettings.enabled` (resolved per-request from
 * globals/assistant/topic by `resolveContextSettings`). Feature
 * ordering in `INTERNAL_FEATURES`: AFTER `staticRemindersFeature` and
 * BEFORE `anthropicCacheFeature` so (a) chef sees the prompt that
 * already includes static reminders, and (b) anthropicCache marks
 * cache_control on the post-chef shape (chef preserves
 * `providerOptions` losslessly through round-trip; verified in plan
 * doc Phase D "Cache cooperation").
 */

import { application } from '@application'
import { definePlugin } from '@cherrystudio/ai-core'
import type { ContextChefOptions } from '@context-chef/ai-sdk-middleware'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'
import { loggerService } from '@logger'
import { getApprovalState } from '@main/services/toolApproval/observability'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('contextBuildFeature')

const DEFAULT_HEAD_CHARS = 500
const DEFAULT_TAIL_CHARS = 1000
/**
 * Tools that handle their own oversize behavior natively and must NOT
 * be funneled through chef's truncate. These either return a structured
 * error (read-style tools with native pagination — persisting their
 * output would route the model right back through the same tool to
 * read the persisted file, looping) or carry inline citations the
 * model can't recover after persist.
 *
 * Citation tools (kb__search / web__search) and the read tools
 * (`fs__read`) are declared via `ToolEntry.truncatable === false`;
 * we just collect those names here for chef's `perTool` exemption list.
 * No hard-coding by name.
 */
/** Last-resort floor when the active model has no `contextWindow` set. */
const FALLBACK_CONTEXT_WINDOW = 128_000

/**
 * Tier-2 fallback: when budget is exceeded AND no compression model
 * resolves (Tier-1 unavailable), drop the oldest messages until the
 * estimated size fits. Chef passes `currentTokens` and `limit`; we
 * approximate per-message cost as proportional to its serialized
 * length and trim from the head until under budget.
 *
 * Two safety floors:
 *   - keep at least 2 messages (the most recent assistant + user pair)
 *   - keep the first `system` role message if present (some chef
 *     compile paths place system at index 0 rather than via the
 *     prompt slot)
 */
const MIN_MESSAGES_KEPT = 2

function dropOldestUntilUnderBudget(
  history: Parameters<NonNullable<ContextChefOptions['onBeforeCompress']>>[0],
  tokenInfo: Parameters<NonNullable<ContextChefOptions['onBeforeCompress']>>[1]
): typeof history {
  const { currentTokens, limit } = tokenInfo
  if (currentTokens <= limit) return history
  if (history.length <= MIN_MESSAGES_KEPT) return history

  // Estimate: assume tokens are uniformly distributed over messages.
  // We don't have a tokenizer here, so use length as a proxy.
  const totalLen = history.reduce((sum, m) => sum + JSON.stringify(m).length, 0)
  const overshoot = currentTokens - limit
  const overshootRatio = overshoot / currentTokens
  let lenToDrop = Math.ceil(totalLen * overshootRatio)

  let dropFromIdx = 0
  // Preserve a leading system message if present.
  if (history[0]?.role === 'system') dropFromIdx = 1

  let dropped = 0
  let cursor = dropFromIdx
  while (cursor < history.length - MIN_MESSAGES_KEPT && lenToDrop > 0) {
    lenToDrop -= JSON.stringify(history[cursor]).length
    cursor++
    dropped++
  }

  if (dropped === 0) return history

  const kept = [...history.slice(0, dropFromIdx), ...history.slice(cursor)]
  logger.info('chef budget exceeded, dropped oldest messages (Tier-2 fallback)', {
    droppedCount: dropped,
    keptCount: kept.length,
    currentTokens,
    limit
  })
  return kept
}

/**
 * Chef invokes `dynamicState.getState()` on every model call and
 * unconditionally injects its return as XML — there is no built-in
 * "skip" sentinel (verified against
 * `@context-chef/ai-sdk-middleware/dist/index.mjs:380` — `getState` is
 * typed `() => Record<string, unknown> | Promise<...>` and the result
 * goes straight into `objectToXml`). To avoid ~80 tokens of empty-XML
 * overhead per call when the topic has no approval activity, we return
 * an empty `{}` object — the smallest valid record — which serializes
 * to `<dynamic_state></dynamic_state>` (~10 tokens). A single warn at
 * module load documents the gap.
 */
let warnedAboutChefSkipBehavior = false
function warnOnceAboutChefSkipBehavior(): void {
  if (warnedAboutChefSkipBehavior) return
  warnedAboutChefSkipBehavior = true
  logger.warn(
    'context-chef does not skip dynamicState injection on empty/undefined return. ' +
      'Returning {} as a minimal stub when no approval activity is present (~10 tokens overhead per call).'
  )
}

function buildChefOptions(scope: RequestScope): ContextChefOptions | null {
  const settings = scope.contextSettings
  if (!settings.enabled) return null

  const contextWindow = scope.model.contextWindow ?? FALLBACK_CONTEXT_WINDOW

  const options: ContextChefOptions = {
    contextWindow,

    // Always-on mechanical pruning. Drops reasoning blocks before the last
    // message and removes empty messages. No LLM cost.
    compact: {
      reasoning: 'before-last-message',
      emptyMessages: 'remove'
    },

    // Always-on tool-result truncation. Backed by chef's own
    // `FileSystemAdapter` pointed at Cherry's `feature.context_chef.vfs`
    // temp dir. The OS reclaims most stale files on macOS/Linux;
    // `VfsBlobService` runs a boot sweep for the Windows case.
    //
    // `perTool` exempts citation tools (web__search, kb__search) where
    // mid-array truncation would break `[id]` references in the model's
    // reply. Read off ToolEntry.truncatable === false at request build
    // time so opt-out is declarative on each entry.
    truncate: {
      threshold: settings.truncateThreshold,
      headChars: DEFAULT_HEAD_CHARS,
      tailChars: DEFAULT_TAIL_CHARS,
      storage: application.get('VfsBlobService').getAdapter(),
      perTool: scope.registry
        .getAll()
        .filter((entry) => entry.truncatable === false)
        .map((entry) => entry.name)
    },

    // Per-iteration injection of recent tool-approval decisions, keyed
    // by topic. Without this hint the model has zero explicit signal
    // that an approval just landed and tends to stall, skip the blocked
    // call, or hallucinate the user's choice.
    //
    // `placement: 'last_user'` (chef default) appends the XML block to
    // the last user message instead of emitting a separate system
    // message. We previously tried `'system'` for "max attention" but
    // it produces a prompt shape with two non-contiguous system
    // messages (original system prompt at the head, chef's
    // dynamic_state at the tail, sandwiching the conversation), which
    // AI SDK's validation rejects with `'Multiple system messages
    // that are separated by user/assistant messages' functionality
    // not supported`. `'last_user'` keeps the prompt single-system and
    // works on every provider chef supports.
    dynamicState: {
      getState: () => {
        const topicId = scope.request.chatId
        if (!topicId) {
          warnOnceAboutChefSkipBehavior()
          return {}
        }
        const state = getApprovalState(topicId)
        if (!state.pendingApprovals.length && !state.recentDecisions.length) {
          warnOnceAboutChefSkipBehavior()
          return {}
        }
        return state as unknown as Record<string, unknown>
      },
      placement: 'last_user'
    },

    // Tier-2 fallback for budget overflow when LLM compression is
    // unavailable. Always wired (even when `compress` is set) so a
    // failed compression call doesn't strand the request — chef calls
    // onBeforeCompress BEFORE invoking the compression model. Returning
    // truncated history here pre-empts the LLM call entirely; returning
    // undefined lets default compression run.
    //
    // We only short-circuit when there's no compression model available
    // (Tier-1 unreachable). When compression IS configured, we let chef
    // run its normal LLM path.
    onBeforeCompress: (history, tokenInfo) => {
      if (options.compress?.model) {
        // Compression model present — let chef do its LLM summary.
        return undefined
      }
      return dropOldestUntilUnderBudget(history, tokenInfo)
    },

    onCompress: (summary, count) => {
      logger.info('chef compressed history', {
        truncatedCount: count,
        summaryPreview: summary.slice(0, 120)
      })
    }
  }

  // Opt-in compression. Resolution of the user-picked model happens
  // upstream in `buildAgentParams` (same path as the agent's main model
  // — `createExecutor → languageModel`), with fallback to the user's
  // topic-naming model already applied. Here we just consume the
  // pre-resolved instance from scope. `null` means either compression
  // is off, no model was configured, or the configured model failed to
  // resolve; any of those routes us through the Tier-2 sliding-window
  // drop in `onBeforeCompress`.
  if (settings.compress.enabled && scope.compressionModel) {
    options.compress = {
      model: scope.compressionModel
    }
  } else if (settings.compress.enabled && settings.compress.modelId && !scope.compressionModel) {
    logger.warn('compress is enabled but model resolution failed — falling back to sliding-window drop', {
      modelId: settings.compress.modelId
    })
  } else if (settings.compress.enabled && !settings.compress.modelId) {
    logger.debug('compress is enabled but no compression modelId resolved — using sliding-window drop only')
  }

  return options
}

function createContextBuildPlugin(scope: RequestScope) {
  return definePlugin({
    name: 'context-build',
    enforce: 'pre',
    configureContext: (context) => {
      const options = buildChefOptions(scope)
      if (!options) return
      context.middlewares = context.middlewares || []
      context.middlewares.push(createMiddleware(options))
    }
  })
}

/**
 * Gated on resolved `contextSettings.enabled` (per-request collapse of
 * globals/assistant/topic). Position in `INTERNAL_FEATURES`: after
 * `staticRemindersFeature`, before `anthropicCacheFeature`.
 */
export const contextBuildFeature: RequestFeature = {
  name: 'context-build',
  applies: (scope) => scope.contextSettings.enabled,
  contributeModelAdapters: (scope) => [createContextBuildPlugin(scope)]
}
