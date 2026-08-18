/**
 * Context-build feature: wires the aiCore context middleware into the AI SDK
 * plugin chain. The role is "build / shape the context the model sees on
 * each call".
 *
 * Layers, all gated on Cherry-owned context and `scope.contextSettings.enabled`:
 * - truncate: large tool results → durable FileManager blobs (anchored
 *   requests) replaced with a <persisted-output> marker (read back via
 *   fs_read), or plain inline head/tail truncation when the request has no
 *   message row to hang a ref on. Threshold is the resolved user setting.
 *   `truncatable: false` entries are exempt.
 * - compact: mechanical, zero-LLM cleanup of truly empty messages. Reasoning
 *   stays intact and provider adapters decide how to serialize it.
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
import { createContextMiddleware, definePlugin, groupIntoTurns } from '@cherrystudio/ai-core'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import {
  APPROX_CHARS_PER_TOKEN,
  IN_FLIGHT_TOOL_OUTPUT_WINDOW_RATIO,
  MIN_IN_FLIGHT_TRUNCATE_THRESHOLD
} from '@main/ai/constants'
import { createFileManagerStorageAdapter } from '@main/ai/contextBuild/persistedOutputAdapter'
import { resolveContextWindow } from '@main/ai/contextBuild/resolveContextWindow'
import { resolveInputRoom } from '@main/ai/contextBuild/resolveInputRoom'
import { resolveRequestedMaxOutputTokens } from '@main/ai/contextBuild/resolveOutputReservation'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('contextBuild')

/** head/tail kept inline in the truncation marker (carried from P1 / #14916). */
const HEAD_CHARS = 500
const TAIL_CHARS = 1_000
/** Never drop below this many messages in the sliding-window fallback. */
const MIN_MESSAGES_KEPT = 2

/**
 * In-flight trim threshold for this request: the smaller of the user's
 * character setting and a share of the model's context window.
 *
 * The two lanes protect different resources and so need different units. The
 * persist lane guards DB size / reload cost — window-independent, characters
 * are the honest unit. The in-flight lane guards the window itself, where a
 * fixed character count means wildly different things per model: the 100k
 * default is ~3% of a 1M window but several times a 16k one, so on small
 * windows it never fired and a single tool result could swamp the request.
 *
 * `contextWindow` is optional on `Model` (custom / v1-imported / CherryAI rows
 * can omit it). With no window known there is nothing to take a share of, so
 * the user's absolute character setting stands alone — never a computed `NaN`,
 * which would make `text.length <= threshold` false for EVERY result and
 * offload ordinary tool output.
 *
 * Exported for tests.
 */
export function resolveInFlightTruncateThreshold(
  configuredChars: number,
  contextWindow: number | undefined,
  outputReservation?: number
): number {
  const window = resolveContextWindow(contextWindow)
  if (window === null) return configuredChars
  const inputRoom = resolveInputRoom(window, outputReservation)
  const windowBudget = Math.floor(inputRoom * IN_FLIGHT_TOOL_OUTPUT_WINDOW_RATIO * APPROX_CHARS_PER_TOKEN)
  return Math.max(MIN_IN_FLIGHT_TRUNCATE_THRESHOLD, Math.min(configuredChars, windowBudget))
}

/** Exported for direct middleware testing. Returns null when the layer is off. */
export function buildContextOptions(scope: RequestScope): ContextMiddlewareOptions | null {
  const settings = scope.contextSettings
  if (scope.request.contextOwner === 'caller' || !settings.enabled) return null

  // Optional on `Model` and optional here: a window-less model gets no
  // window-derived budget rather than a `NaN` one (see resolveContextWindow).
  const contextWindow = resolveContextWindow(scope.model.contextWindow)
  if (contextWindow === null) {
    logger.warn('model declares no contextWindow — window-relative budgets disabled for this request', {
      modelId: scope.model.id
    })
  }

  const options: ContextMiddlewareOptions = {
    contextWindow: contextWindow ?? undefined,

    compact: {
      reasoning: 'none',
      emptyMessages: 'remove'
    },

    truncate: {
      threshold: resolveInFlightTruncateThreshold(
        settings.truncateThreshold,
        scope.model.contextWindow,
        resolveRequestedMaxOutputTokens(
          scope.request.callOverrides?.maxOutputTokens,
          undefined,
          scope.assistant,
          scope.model,
          scope.endpointType
        )
      ),
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
  // Also requires a window: the guard compares an estimate against the budget,
  // and aiCore rejects `onBeforeCompress` without a `contextWindow` outright
  // (previously the `as number` cast smuggled a `NaN` past that check and every
  // comparison against it was silently false).
  if (settings.compress.enabled && !scope.compressionModel && contextWindow !== null) {
    logger.debug('compress enabled but no model resolved — sliding-window fallback only')
    options.onBeforeCompress = (history, tokenInfo) => dropOldestUntilUnderBudget(history, tokenInfo)
  }

  return options
}

/**
 * Whether the request's id maps to a real `message` row — the chat path's
 * assistant placeholder, committed before dispatch, that a provisional
 * `tool_output` ref can target. Temporary chats carry a synthetic uuid with no
 * row and one-shot `streamPrompt` calls (translate / naming / probes) carry a
 * random one; for those the truncator falls back to plain inline head/tail
 * truncation, so no `<persisted-output>` marker can ever be produced.
 *
 * Resolved ONCE per request at param-build time and carried on the scope
 * (`canOffloadToolOutputs`), because it gates two things: the storage adapter
 * below and fs_read's admission (a request that cannot mint a marker has no
 * use for the tool that reads one back).
 */
export function hasAnchorRow(messageId: string | undefined): boolean {
  if (messageId === undefined) return false
  try {
    messageService.getById(messageId)
    return true
  } catch (error) {
    // getById throws NOT_FOUND for missing rows (it never returns null) —
    // that's the expected non-anchored case. Anything else is a real failure.
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return false
    throw error
  }
}

/**
 * Storage for the truncate layer. `canOffloadToolOutputs` already folds in the
 * anchor lookup (plus the enablement and context-owner checks this function's
 * caller has re-verified), so this never re-queries the row.
 */
function resolveTruncateStorage(scope: RequestScope): VFSStorageAdapter | undefined {
  if (!scope.canOffloadToolOutputs) return undefined
  return createFileManagerStorageAdapter({
    messageId: scope.requestContext.requestId,
    persistedOutputPaths: scope.requestContext.persistedOutputPaths
  })
}

/**
 * Drop the oldest turns until the estimate is under budget, keeping at least
 * MIN_MESSAGES_KEPT messages. Length is a proxy for tokens (no tokenizer here).
 * Ported from PR #14916.
 *
 * Drops whole TURNS, never single messages: `assistant(tool_call)` and the tool
 * results answering it are one atomic unit (`groupIntoTurns`, the same rule the
 * LLM compaction paths use). A per-message cursor could stop between them and
 * emit an orphan tool result — or an assistant tool-call with no result — which
 * strict providers reject outright. The Janitor re-estimates after this hook and
 * returns early once under budget, so it will NOT re-run `ensureValidHistory`:
 * whatever is returned here goes to the provider as-is.
 */
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

  const dropFromIdx = history[0]?.role === 'system' ? 1 : 0
  const maxCursor = history.length - MIN_MESSAGES_KEPT

  let cursor = dropFromIdx
  let dropped = 0
  for (const turn of groupIntoTurns(history)) {
    if (turn.startIndex < dropFromIdx) continue
    if (lenToDrop <= 0) break
    // Only drop a turn we can drop ENTIRELY while leaving the minimum tail.
    if (turn.endIndex > maxCursor) break
    for (let i = turn.startIndex; i < turn.endIndex; i++) {
      lenToDrop -= JSON.stringify(history[i]).length
      dropped++
    }
    cursor = turn.endIndex
  }
  if (dropped === 0) return history

  const kept = [...history.slice(0, dropFromIdx), ...history.slice(cursor)]
  logger.info('context budget exceeded, dropped oldest turns (sliding-window fallback)', {
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
  applies: (scope) => scope.request.contextOwner !== 'caller' && scope.contextSettings.enabled,
  contributeModelAdapters: (scope) => [createContextBuildPlugin(scope)]
}
