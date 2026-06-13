/**
 * Context-build feature: wires context-management middleware into the AI SDK
 * plugin chain. chef (@context-chef/ai-sdk-middleware) is the implementation;
 * the role is "build / shape the context the model sees on each call".
 *
 * Layers, all gated on `scope.contextSettings.enabled`:
 * - truncate: large tool results → VfsBlobService, replaced with a
 *   <persisted-output> marker (read back via fs_read). Threshold is the
 *   resolved user setting. `truncatable: false` entries are exempt.
 * - compact: mechanical, zero-LLM pruning (drop reasoning before the last
 *   message; drop empty messages).
 * - compress: LLM history summarization when over the model's context
 *   budget — only when enabled AND a compression model resolved. This is
 *   the IN-FLIGHT path; P2-B stage 2 adds durable cherry-driven compaction
 *   on top, after which this becomes the safety-net.
 * - onBeforeCompress: no-LLM sliding-window fallback (drop oldest) used when
 *   the budget is exceeded but no compression model is available.
 * - logger: routes chef degradation warnings to loggerService.
 *
 * Ordering invariant: registered before anthropicCacheFeature so truncation
 * happens before cache markers are placed (see features/index.ts).
 */
import { application } from '@application'
import { definePlugin } from '@cherrystudio/ai-core'
import type { ContextChefOptions } from '@context-chef/ai-sdk-middleware'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'
import { loggerService } from '@logger'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('contextBuild')

/** head/tail kept inline in the truncation marker (carried from P1 / #14916). */
const HEAD_CHARS = 500
const TAIL_CHARS = 1_000
/** Last-resort context window when the model row has none. */
const FALLBACK_CONTEXT_WINDOW = 128_000
/** Never drop below this many messages in the sliding-window fallback. */
const MIN_MESSAGES_KEPT = 2

/** Exported for direct middleware testing. Returns null when the layer is off. */
export function buildChefOptions(scope: RequestScope): ContextChefOptions | null {
  const settings = scope.contextSettings
  if (!settings.enabled) return null

  const options: ContextChefOptions = {
    contextWindow: scope.model.contextWindow ?? FALLBACK_CONTEXT_WINDOW,

    compact: {
      reasoning: 'before-last-message',
      emptyMessages: 'remove'
    },

    truncate: {
      threshold: settings.truncateThreshold,
      headChars: HEAD_CHARS,
      tailChars: TAIL_CHARS,
      storage: application.get('VfsBlobService').getAdapter(),
      // Declarative opt-out: `truncatable: false` entries (citation +
      // read-style tools) are preserved verbatim.
      perTool: scope.registry
        .getAll()
        .filter((entry) => entry.truncatable === false)
        .map((entry) => entry.name)
    },

    logger: { warn: (message, ...args) => logger.warn(message, { args }) }
  }

  // Compression machinery (and chef's budget Janitor) only when the user
  // wants it. When compress is off, NONE of compress/onCompress/
  // onBeforeCompress is set, so chef builds no Janitor — truncate + compact
  // only, and no spurious "no tokenizer / no compressionModel" warnings.
  if (settings.compress.enabled) {
    options.onCompress = (summary, count) => {
      logger.info('chef compressed history (in-flight)', {
        truncatedCount: count,
        summaryPreview: summary.slice(0, 120)
      })
    }

    if (scope.compressionModel) {
      // LLM summarization on budget overflow (chef's default budget path).
      options.compress = { model: scope.compressionModel }
    } else {
      // Wanted compression but no model resolved → no-LLM sliding-window guard.
      // (No tokenizer is wired yet, so this can only fire once reported usage
      // exists; wiring tokenx here is the planned follow-up — see plan notes.)
      logger.debug('compress enabled but no model resolved — sliding-window fallback only')
      options.onBeforeCompress = (history, tokenInfo) => dropOldestUntilUnderBudget(history, tokenInfo)
    }
  }

  return options
}

/** Drop the oldest non-system messages until the estimate is under budget,
 *  keeping at least MIN_MESSAGES_KEPT. Length is a proxy for tokens (no
 *  tokenizer here). Ported from PR #14916. */
function dropOldestUntilUnderBudget(
  history: Parameters<NonNullable<ContextChefOptions['onBeforeCompress']>>[0],
  tokenInfo: Parameters<NonNullable<ContextChefOptions['onBeforeCompress']>>[1]
): typeof history {
  const { currentTokens, limit } = tokenInfo
  if (currentTokens <= limit) return history
  if (history.length <= MIN_MESSAGES_KEPT) return history

  const totalLen = history.reduce((sum, m) => sum + JSON.stringify(m).length, 0)
  const overshootRatio = (currentTokens - limit) / currentTokens
  let lenToDrop = Math.ceil(totalLen * overshootRatio)

  let dropFromIdx = 0
  if (history[0]?.role === 'system') dropFromIdx = 1

  let cursor = dropFromIdx
  let dropped = 0
  while (cursor < history.length - MIN_MESSAGES_KEPT && lenToDrop > 0) {
    lenToDrop -= JSON.stringify(history[cursor]).length
    cursor++
    dropped++
  }
  if (dropped === 0) return history

  const kept = [...history.slice(0, dropFromIdx), ...history.slice(cursor)]
  logger.info('chef budget exceeded, dropped oldest (sliding-window fallback)', {
    droppedCount: dropped,
    keptCount: kept.length,
    currentTokens,
    limit
  })
  return kept
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

export const contextBuildFeature: RequestFeature = {
  name: 'context-build',
  applies: (scope) => scope.contextSettings.enabled,
  contributeModelAdapters: (scope) => [createContextBuildPlugin(scope)]
}
