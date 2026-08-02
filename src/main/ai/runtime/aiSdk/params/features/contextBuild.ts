/**
 * Context-build feature: wires the aiCore context middleware into the AI SDK
 * plugin chain. The role is "build / shape the context the model sees on
 * each call".
 *
 * Layers, all gated on `scope.contextSettings.enabled`:
 * - truncate: large tool results → durable FileManager blobs (anchored
 *   requests) replaced with a <persisted-output> marker (read back via
 *   fs_read), or plain inline head/tail truncation when the request has no
 *   message row to hang a ref on. Threshold is the resolved user setting.
 *   `truncatable: false` entries are exempt.
 * - compact: mechanical, zero-LLM pruning (drop reasoning before the last
 *   message; drop empty messages).
 * - onBeforeCompress: no-LLM sliding-window fallback (drop oldest) — the only
 *   remaining budget guard; active when compress is enabled but no compression
 *   model is configured. In-flight LLM compress was removed in P2-B stage 2:
 *   durable cherry-driven compaction (turn-start) + the mid-loop in-loop
 *   compaction (prepareStep) hook now own LLM summarization; running an
 *   in-flight compress too would double-compress.
 * - logger: routes middleware degradation warnings to loggerService.
 *
 * Ordering invariant: registered before anthropicCacheFeature so truncation
 * happens before cache markers are placed (see internalFeatures.ts).
 */
import type { ContextMiddlewareOptions, TruncateOptions, VFSStorageAdapter } from '@cherrystudio/ai-core'
import { createContextMiddleware, definePlugin } from '@cherrystudio/ai-core'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { createFileManagerStorageAdapter } from '@main/ai/contextBuild/persistedOutputAdapter'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('contextBuild')

/** head/tail kept inline in the truncation marker (carried from P1 / #14916). */
const HEAD_CHARS = 500
const TAIL_CHARS = 1_000
/** Never drop below this many messages in the sliding-window fallback. */
const MIN_MESSAGES_KEPT = 2

/** Exported for direct middleware testing. Returns null when the layer is off. */
export function buildContextOptions(scope: RequestScope): ContextMiddlewareOptions | null {
  const settings = scope.contextSettings
  if (!settings.enabled) return null

  const options: ContextMiddlewareOptions = {
    // Required input — the model layer's contract guarantees it; never defaulted here.
    contextWindow: scope.model.contextWindow as number,

    compact: {
      reasoning: 'before-last-message',
      emptyMessages: 'remove'
    },

    truncate: {
      threshold: settings.truncateThreshold,
      headChars: HEAD_CHARS,
      tailChars: TAIL_CHARS,
      storage: resolveTruncateStorage(scope),
      // Lane rules per entry: `truncatable: false` → bare-string preserve
      // (unconditional — fs_read's loop protection, even if a codec exists);
      // codec-bearing entries → entity-level trimming via the codec closure;
      // everything else → default opaque policy.
      perTool: scope.registry.getAll().flatMap((entry): NonNullable<TruncateOptions['perTool']> => {
        if (entry.truncatable === false) return [entry.name]
        if (entry.codec) return [{ name: entry.name, codec: entry.codec }]
        return []
      })
    },

    logger: { warn: (message, ...args) => logger.warn(message, { args }) }
  }

  // In-flight LLM compress was removed in P2-B stage 2: durable cherry-driven compaction
  // (turn-start) + the mid-loop in-loop compaction (prepareStep) hook now own LLM summarization,
  // and running an in-flight compress too would double-compress. The no-LLM sliding-window
  // remains as the only guard when compression is enabled but no model is configured
  // (the durable path also needs a model).
  if (settings.compress.enabled && !scope.compressionModel) {
    logger.debug('compress enabled but no model resolved — sliding-window fallback only')
    options.onBeforeCompress = (history, tokenInfo) => dropOldestUntilUnderBudget(history, tokenInfo)
  }

  return options
}

/**
 * Storage for the truncate layer, decided per request. Anchored = the
 * request's id maps to a real `message` row (the chat path's assistant
 * placeholder, committed before dispatch) that a provisional `tool_output`
 * ref can target. Temporary chats carry a synthetic uuid with no row and
 * one-shot `streamPrompt` calls (translate / naming / probes) carry a random
 * one — for those, no storage: the truncator falls back to plain inline
 * head/tail truncation (these paths practically never produce oversized tool
 * outputs, and there is nothing to own a durable blob's lifetime).
 */
function resolveTruncateStorage(scope: RequestScope): VFSStorageAdapter | undefined {
  const anchorId = scope.requestContext.requestId
  if (!messageService.getById(anchorId)) return undefined
  return createFileManagerStorageAdapter({
    messageId: anchorId,
    persistedOutputPaths: scope.requestContext.persistedOutputPaths
  })
}

/** Drop the oldest non-system messages until the estimate is under budget,
 *  keeping at least MIN_MESSAGES_KEPT. Length is a proxy for tokens (no
 *  tokenizer here). Ported from PR #14916. */
function dropOldestUntilUnderBudget(
  history: Parameters<NonNullable<ContextMiddlewareOptions['onBeforeCompress']>>[0],
  tokenInfo: Parameters<NonNullable<ContextMiddlewareOptions['onBeforeCompress']>>[1]
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
  logger.info('context budget exceeded, dropped oldest (sliding-window fallback)', {
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
      const options = buildContextOptions(scope)
      if (!options) return
      context.middlewares = context.middlewares || []
      context.middlewares.push(createContextMiddleware(options))
    }
  })
}

export const contextBuildFeature: RequestFeature = {
  name: 'context-build',
  applies: (scope) => scope.contextSettings.enabled,
  contributeModelAdapters: (scope) => [createContextBuildPlugin(scope)]
}
