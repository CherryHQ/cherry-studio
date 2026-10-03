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
 *   model is configured, and for temporary chats, which neither LLM lane
 *   serves. In-flight LLM compress was removed in P2-B stage 2:
 *   durable cherry-driven compaction (turn-start) + the mid-loop in-loop
 *   compaction (prepareStep) hook now own LLM summarization; running an
 *   in-flight compress too would double-compress.
 * - logger: routes middleware degradation warnings to loggerService.
 *
 * Ordering invariant: registered before anthropicCacheFeature so truncation
 * happens before cache markers are placed (see internalFeatures.ts).
 */
import type { ContextMiddlewareOptions, TruncateOptions, VFSStorageAdapter } from '@cherrystudio/ai-core'
import { createContextMiddleware, definePlugin, estimateMessages, groupIntoTurns } from '@cherrystudio/ai-core'
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
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('contextBuild')

/** head/tail kept inline in the truncation marker (carried from P1 / #14916). */
const HEAD_CHARS = 500
const TAIL_CHARS = 1_000

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

  const outputReservation = resolveRequestedMaxOutputTokens(
    scope.request.callOverrides?.maxOutputTokens,
    scope.assistant,
    scope.model,
    scope.endpointType
  )
  const options: ContextMiddlewareOptions = {
    compact: {
      reasoning: 'none',
      emptyMessages: 'remove'
    },

    truncate: {
      threshold: resolveInFlightTruncateThreshold(
        settings.truncateThreshold,
        scope.model.contextWindow,
        outputReservation
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
  // remains the guard for requests neither lane serves: no model resolved, or a temporary
  // chat (durable needs stored rows; in-loop skips them).
  // Also requires a window: the guard compares an estimate against the budget,
  // and aiCore rejects `onBeforeCompress` without a `contextWindow` outright
  // (previously the `as number` cast smuggled a `NaN` past that check and every
  // comparison against it was silently false).
  if (settings.compress.enabled && contextWindow !== null && (!scope.compressionModel || isTemporaryChat(scope))) {
    logger.debug('no LLM compaction lane for this request — sliding-window fallback only')
    // Same trigger as the LLM lanes: a share of the room the prompt actually has.
    options.contextWindow = Math.floor(
      (resolveInputRoom(contextWindow, outputReservation) * settings.compress.thresholdPercent) / 100
    )
    options.onBeforeCompress = (history, tokenInfo) => dropOldestUntilUnderBudget(history, tokenInfo)
  }

  return options
}

function isTemporaryChat(scope: RequestScope): boolean {
  const topicId = scope.request.conversation.topicId
  return topicId !== undefined && temporaryChatService.hasTopic(topicId)
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
 * Drop the oldest whole turns until the history fits the budget. Ported from
 * PR #14916.
 *
 * Strict providers reject a conversation that opens on an assistant or tool
 * row, and the newest user message is the request itself. So turns before that
 * message are cut only at a user boundary; when dropping all of them is not
 * enough, the oldest steps after it go next, always keeping the newest turn.
 * Turns are atomic (`groupIntoTurns`): an `assistant(tool_call)` leaves with its
 * results, so nothing is orphaned. The Janitor sends the result as-is, without
 * re-running `ensureValidHistory`.
 */
function dropOldestUntilUnderBudget(
  history: Parameters<NonNullable<ContextMiddlewareOptions['onBeforeCompress']>>[0],
  tokenInfo: Parameters<NonNullable<ContextMiddlewareOptions['onBeforeCompress']>>[1]
): typeof history {
  const { currentTokens, limit } = tokenInfo
  if (currentTokens <= limit) return history
  const lastUser = history.findLastIndex((m) => m.role === 'user')
  if (lastUser < 0) return history

  const head = history[0]?.role === 'system' ? 1 : 0
  const turns = groupIntoTurns(history).filter((turn) => turn.startIndex >= head)
  const cost = (turn: { startIndex: number; endIndex: number }) =>
    estimateMessages(history.slice(turn.startIndex, turn.endIndex))
  let excess = currentTokens - limit

  let cut = head
  let pending = 0
  for (const turn of turns) {
    if (excess <= 0 || turn.startIndex >= lastUser) break
    pending += cost(turn)
    if (history[turn.endIndex]?.role === 'user') {
      cut = turn.endIndex
      excess -= pending
      pending = 0
    }
  }

  const steps = turns.filter((turn) => turn.startIndex > lastUser)
  let droppedSteps = 0
  while (excess > 0 && droppedSteps < steps.length - 1) {
    excess -= cost(steps[droppedSteps])
    droppedSteps++
  }
  if (cut === head && droppedSteps === 0) return history

  const kept = [
    ...history.slice(0, head),
    ...history.slice(cut, lastUser + 1),
    ...history.slice(droppedSteps > 0 ? steps[droppedSteps].startIndex : lastUser + 1)
  ]
  logger.info('context budget exceeded, dropped oldest turns (sliding-window fallback)', {
    droppedCount: history.length - kept.length,
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
