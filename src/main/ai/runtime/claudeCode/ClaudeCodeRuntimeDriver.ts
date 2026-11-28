import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { validate as isUuid } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { logAiFailure } from '@main/ai/errorReporting'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  AgentImageLimitError,
  normalizeAgentImageLimitFailure,
  parseUpstreamImageLimit
} from '@shared/ai/agentImageLimits'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeReconcileResult,
  AgentSessionRuntimeDriver
} from '../types'
import { type UnavailableNativeContext, unavailableNativeContext } from '../types'
import {
  buildClaudeCodeQueryRequestForAgentSession,
  type ConnectionConfig,
  deriveConnectionConfig,
  toolPolicyFactsEqual
} from './agentSessionWarmup'
import { createClaudeCodeProcessDiagnostics, createSpawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
import { claudeBranchQueryIdentity } from './claudeContext'
import { forkClaudeSession } from './claudeFork'
import { ClaudeSdkConnection } from './ClaudeSdkConnection'
import { classifyClaudeFailure } from './failureFacts'
import { ClaudeForkCheckpointSchema } from './forkCheckpoint'
import {
  AgentSessionWorkspaceError,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory,
  registerMcpSessionCatalogSync
} from './settingsBuilder'
import { claudeWorkspaceRelocation } from './workspaceRelocation'

const logger = loggerService.withContext('ClaudeCodeRuntimeDriver')

function getChangedRebuildFacts(baseline: ConnectionConfig, fresh: ConnectionConfig): string[] {
  const baselineFacts = baseline.rebuildFactFingerprints
  const freshFacts = fresh.rebuildFactFingerprints
  if (!baselineFacts || !freshFacts) return ['unknown']

  const changedFacts = [...new Set([...Object.keys(baselineFacts), ...Object.keys(freshFacts)])]
    .filter((name) => baselineFacts[name] !== freshFacts[name])
    .sort()
  return changedFacts.length > 0 ? changedFacts : ['unknown']
}

class ClaudeCodeRuntimeConnection extends ClaudeSdkConnection<AgentRuntimeConnectInput & { modelId: UniqueModelId }> {
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  /** Staleness identity captured by the materialized request; live facts advance during reconcile. */
  private connectionConfig?: ConnectionConfig
  /** Serializes reconciles per connection so push/pull can't interleave SDK and snapshot writes. */
  private reconcileChain: Promise<unknown> = Promise.resolve()

  constructor(input: AgentRuntimeConnectInput) {
    if (!isUniqueModelId(input.modelId)) throw new Error('Provider model required')
    super({ ...input, modelId: input.modelId })
  }

  async start(): Promise<this | UnavailableNativeContext> {
    // Route with the host-chosen model, not a fresh DB read: a live turn's connection must serve
    // the model captured when that turn was created, even if the agent was edited since.
    const storedResume = messages.getLastRuntimeResumeToken(this.input.sessionId, this.input.branchHead)
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      this.input.sessionId,
      storedResume,
      this.input.modelId,
      this.input.reasoningEffort ?? 'default',
      this.input.fastMode === true,
      this.input.knowledgeBaseIds,
      this.input.serviceTier,
      this.input.headless === true,
      this.input.permissionModeOverride
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig
    this.approvalEmitter = request.settings.approvalEmitter
    this.assistantFileToolsEnabled = Boolean(request.settings.mcpServers?.['assistant-files'])
    this.context = this.prepareContext(
      request.options.env,
      storedResume ?? request.options.resume ?? this.input.nativeSessionId,
      this.input.branchHead,
      true
    )
    if (!this.context.nativeThreadId || !isUuid(this.context.nativeThreadId))
      return unavailableNativeContext(this.context, 'Invalid Claude session identity')

    const traceEnv = await this.prepareTraceEnv()
    const coldProcessDiagnostics = createClaudeCodeProcessDiagnostics()
    const options: Options = {
      ...request.options,
      ...claudeBranchQueryIdentity(this.context, storedResume ?? undefined),
      ...(traceEnv
        ? {
            env: {
              ...request.options.env,
              ...traceEnv
            }
          }
        : {}),
      abortController: this.abortController,
      spawnClaudeCodeProcess: createSpawnClaudeCodeProcess(coldProcessDiagnostics)
    }
    if (!options.resume) this.resumeToken = undefined
    // Env is part of the warm signature, so a traced turn asks with the OTEL vars merged in and can
    // never match a query parked without them: the mismatch cold-starts and disposes the stale park,
    // which is exactly what tracing needs (env is fixed at spawn). No trace branch required here.
    const consumedWarmQuery = await application.get('ClaudeCodeWarmQueryManager').consume({
      key: request.key,
      options,
      initializeTimeoutMs: request.initializeTimeoutMs,
      connectionRebuildSignature: request.connectionConfig?.rebuildSignature,
      credentialsFingerprint: request.credentialsFingerprint,
      usageCapture: request.usageCapture,
      knowledgeBaseIds: request.knowledgeBaseIds,
      notificationContext: request.notificationContext
    })
    this.parkedQuery = consumedWarmQuery

    // A matching warm process may have selected a different rotated key when
    // it was started. Its receipt, not the freshly materialized request's,
    // describes the credential that will actually serve this connection.
    this._usageCapture = consumedWarmQuery?.usageCapture ?? request.usageCapture
    this.processDiagnostics = consumedWarmQuery?.processDiagnostics ?? coldProcessDiagnostics
    this.spawnOptions = consumedWarmQuery
      ? { ...options, spawnClaudeCodeProcess: createSpawnClaudeCodeProcess(consumedWarmQuery.processDiagnostics) }
      : options
    this.sdkModelId = request.sdkModelId
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
    this.toolPolicySnapshot?.setPermissionMode(request.connectionConfig?.live.toolPolicy.permissionMode ?? undefined)
    registerMcpSessionCatalogSync(
      this.input.sessionId,
      this.input.agentId,
      request.connectionConfig?.live.toolPolicy.mcps ?? [],
      this.mcpToolMetadata
    )
    try {
      return await this.startSdk(options, this.context, request.contextWindow, consumedWarmQuery)
    } catch (error) {
      if (error instanceof LocalAgentSessionRestoreError) return unavailableNativeContext(this.context, error.message)
      throw error
    }
  }

  async reconcile(input: Parameters<AgentRuntimeConnection['reconcile']>[0]): Promise<AgentRuntimeReconcileResult> {
    // Serialize per connection: a push (agent-updated) and a pull (fresh-turn check) reconciling
    // concurrently could interleave the SDK setPermissionMode and snapshot writes, leaving the local
    // gate and the subprocess on different policies.
    const run = this.reconcileChain.then(
      () => this.reconcileOnce(input),
      () => this.reconcileOnce(input)
    )
    this.reconcileChain = run.catch(() => undefined)
    return run
  }

  private async reconcileOnce(
    input: Parameters<AgentRuntimeConnection['reconcile']>[0]
  ): Promise<AgentRuntimeReconcileResult> {
    if (!this.handle) return 'rebuild'
    if (!isUniqueModelId(input.modelId)) return 'invalid'
    const derived = await deriveConnectionConfig(
      this.input.sessionId,
      input.modelId,
      input.reasoningEffort ?? 'default',
      input.fastMode === true,
      input.knowledgeBaseIds,
      input.serviceTier,
      input.headless === true,
      input.permissionModeOverride
    )
    if (!derived.ok) return 'invalid'
    const baseline = this.connectionConfig
    // A connection without its materialized baseline cannot prove what the subprocess serves.
    if (!baseline) return 'rebuild'

    const fresh = derived.config
    let patched = false
    // Apply the live tool-policy facts BEFORE the rebuild verdict, mid-turn included: the SDK applies
    // a permission-mode change from the next tool call without interrupting the running turn.
    if (!toolPolicyFactsEqual(baseline.live.toolPolicy, fresh.live.toolPolicy)) {
      try {
        const agent = agentService.getAgent(this.input.agentId)
        if (!agent) return 'invalid'
        const permissionMode = fresh.live.toolPolicy.permissionMode ?? 'default'
        if (baseline.live.toolPolicy.permissionMode !== fresh.live.toolPolicy.permissionMode) {
          const changed = await this.handle.claude.setPermissionMode(permissionMode)
          if (changed.status !== 'confirmed') throw new Error(changed.error.message)
          // Approval must use the confirmed mode while the tool catalog is refreshing.
          this.toolPolicySnapshot?.setPermissionMode(fresh.live.toolPolicy.permissionMode ?? undefined)
        }
        await this.toolPolicySnapshot?.update(agent)
      } catch (error) {
        logger.warn('Live tool-policy apply failed during reconcile', { sessionId: this.input.sessionId, error })
        return 'failed'
      }
      this.connectionConfig = { ...baseline, live: fresh.live }
      patched = true
    }

    if (baseline.rebuildSignature !== fresh.rebuildSignature) {
      logger.info('Connection configuration requires rebuild', {
        sessionId: this.input.sessionId,
        changedFacts: getChangedRebuildFacts(baseline, fresh),
        baselineSignature: baseline.rebuildSignature.slice(0, 12),
        freshSignature: fresh.rebuildSignature.slice(0, 12)
      })
      return 'rebuild'
    }
    return patched ? 'patched' : 'current'
  }

  protected disposeSettings() {
    disposeToolPolicySnapshot(this.input.sessionId)
  }
}

export class ClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly workspaceRelocation = claudeWorkspaceRelocation
  readonly fork = forkClaudeSession
  isForkCheckpoint(value: unknown): boolean {
    return ClaudeForkCheckpointSchema.safeParse(value).success
  }
  readonly type = 'claude-code'

  async validateSession(session: AgentSessionEntity): Promise<void> {
    await application.get('ClaudeCodeBinaryService').ensureExecutable()
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
    }
    await prepareClaudeCodeWorkspaceDirectory(session)
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    let connection = new ClaudeCodeRuntimeConnection(input)
    try {
      const opened = await connection.start()
      if (!('status' in opened)) return opened
      await connection.close()
      contexts.rebuildFileBranch(opened.context)
      logger.warn('Rebuilding Claude context from session messages', {
        sessionId: input.sessionId,
        reason: opened.reason
      })
      connection = new ClaudeCodeRuntimeConnection(input)
      const rebuilt = await connection.start()
      if (!('status' in rebuilt)) return rebuilt
      throw new Error(rebuilt.reason)
    } catch (error) {
      logAiFailure(logger, 'Claude Code startup failed', error, 'agent.claude.start', classifyClaudeFailure(error))
      await connection.close()
      throw error
    }
  }

  onSessionIdle(sessionId: string): void {
    // `prewarmAgentSession` bakes the session's trace env when trace mode is on, so the park it
    // leaves behind matches what the next turn asks for either way — no driver-side guard needed.
    void application.get('ClaudeCodeWarmQueryManager').prewarmAgentSession(sessionId)
  }
}

/**
 * Consume the pending image count that best matches a provider `result`
 * failure. Exported for regression coverage: the queue holds submitted native
 * block counts in order, and a later `result` failure names only the limit.
 * The oldest over-limit submission wins (not the maximum), so a two-image
 * failure while a five-image steer is still queued unplaced reports two and
 * preserves the steer's entry. Unrelated failures (no parsed limit) settle
 * the oldest submission (FIFO, matching turn-complete `shift`), so an
 * unrelated failure settling a five-image request while a text steer waits
 * drops five and preserves the steer's zero for the next limit failure.
 * Mutates `pending` in place (splice/shift).
 *
 * When the oldest submission cannot explain the failure (it carries images
 * but stays within the parsed limit), the request may have grown after
 * submission — a tool can attach another image mid-turn — so the actual sent
 * count is unknown. Claiming a later unplaced steer's count would misattribute
 * the failure and consume its entry, so this preserves the queue and returns
 * `undefined` so the caller keeps the provider's own limit text. A leading
 * text-only entry (`0`) can never fail with an image cap, so the search skips
 * it to find the placed image request it precedes.
 *
 * TODO(#20030): correlate with native request UUIDs (`input-boundary` /
 * `requesting` membership from the 0.3.311 adapter) instead of order when
 * placement tracking is available.
 */
export function consumePendingImageCount(pending: number[], failure: unknown): number | undefined {
  if (pending.length === 0) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? String((failure as { message?: unknown }).message)
          : undefined
  const limit = parseUpstreamImageLimit(message)
  if (limit !== undefined) {
    // Oldest-first: the provider reports the placed request, and queued
    // steers have not been placed yet (see placement contract in
    // packages/agent-runtime-claude-code/README).
    if (pending[0] > limit) {
      const [count] = pending.splice(0, 1)
      return count
    }
    // A leading text-only entry can never trip an image cap, so a later
    // over-limit must be the placed image request it precedes.
    if (pending[0] === 0) {
      for (let i = 1; i < pending.length; i++) {
        if (pending[i] > limit) {
          const [count] = pending.splice(i, 1)
          return count
        }
      }
    }
    // Otherwise the oldest carries images but stays within the parsed limit:
    // it may have grown via tools after submission, so the actual sent count
    // is unknown. Preserve the queue (notably an unplaced steer's count) and
    // let the caller keep the provider's limit text instead of claiming an
    // unplaced count was sent.
    return undefined
  }
  return pending.shift()
}

/**
 * Track native placement for image attribution (#20030).
 * Adds the input when its facts include `placed` and never removes on
 * outcome: input outcomes precede the terminal result batch, so membership
 * must survive until `consumePlacedImageCount` (failure) or turn-complete
 * (success) retires the settled input. Removing on outcome would drop a
 * text-only placed request that grew via tools past the provider cap before
 * its `result` failure arrives, letting the no-placement fallback consume an
 * unplaced steer's count and misreport it as sent.
 * Exported for regression coverage of the outcome-before-result sequence.
 */
export function trackPlacedImageInput(
  placed: Set<string>,
  placedId: string | undefined,
  input: { facts: readonly string[]; outcome?: unknown }
): void {
  if (placedId && input.facts.includes('placed')) placed.add(placedId)
}

/**
 * Restore native placement from an overflow/recovery snapshot (#20030).
 * The observer can fold a placed follow-up's `input.changed` delta into a
 * `gap` + snapshot recovery before the rejected `result` arrives. Without
 * restoration, a placed text-only request that grew via tools past the
 * provider cap would have no recorded placement, so result attribution could
 * consume an unplaced steer's count and report it as sent. Only IDs still
 * pending are restored so stale history cannot pollute the next attribution.
 * Exported for regression coverage of the overflow-before-result sequence.
 */
export function restorePlacedImageInputs(
  placed: Set<string>,
  pending: readonly { inputId: string }[],
  inputs: readonly { inputId?: unknown; facts: readonly string[] }[] | undefined
): void {
  if (!inputs?.length || pending.length === 0) return
  const pendingIds = new Set(pending.map((entry) => entry.inputId))
  for (const input of inputs) {
    const id = typeof input.inputId === 'string' ? input.inputId : undefined
    if (id && pendingIds.has(id) && input.facts.includes('placed')) placed.add(id)
  }
}

/**
 * Membership-aware result attribution for the Claude driver (#20030).
 * `pending` holds submitted inputs in order with their product input ids;
 * `placed` is native request membership: `input-boundary` steers plus
 * ordinary follow-up sends observed via their `placed` fact (0.3.311
 * `requesting` signal). Only placed inputs share the native response that
 * failed.
 *
 * - Limit failures: the oldest placed over-limit entry wins when a single
 *   placed input carries images; unplaced steers are never reported as sent.
 *   When no placement has been observed yet (e.g. the result arrives before
 *   the membership batch), fall back to oldest-first over-limit attribution
 *   so an ordinary two-image follow-up still yields typed detail. When the
 *   oldest placed entry cannot explain the failure (text-only `0` or
 *   within-limit images that may have grown via tools after submission),
 *   the actual sent count is unknown — retire all settled inputs and return
 *   `undefined` so the caller keeps the provider's own limit text while
 *   preserving unplaced steers. When several placed inputs each carry images
 *   (e.g. a one-image prompt plus a two-image steer sharing one rejected
 *   continuation), the native request may combine them, so no single entry's
 *   count is a reliable sent total: retire all settled inputs and return
 *   `undefined` to preserve the provider text.
 * - Unrelated failures (no parsed limit): settle placed entries response-scoped
 *   (FIFO among placed, matching turn-complete), preserving unplaced steers
 *   for the next limit failure. With no placement observed, falls back to the
 *   oldest submission. A terminal result settles every placed input sharing
 *   that response, so retire all placed entries and preserve unplaced inputs.
 *
 * Mutates `pending` and `placed` in place.
 */
export function consumePlacedImageCount(
  pending: Array<{ inputId: string; count: number }>,
  placed: Set<string>,
  failure: unknown
): number | undefined {
  if (pending.length === 0) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? String((failure as { message?: unknown }).message)
          : undefined
  const limit = parseUpstreamImageLimit(message)
  if (limit !== undefined) {
    const placedInOrder = pending.filter((entry) => placed.has(entry.inputId))
    if (placedInOrder.length === 0) {
      // No native membership observed yet (ordinary follow-up before the
      // `requesting` batch propagates): attribute oldest-first so a two-image
      // follow-up with a one-image cap still yields typed after-send detail.
      // A leading text-only `0` can never trip the cap, so skip it to reach
      // the placed image request it precedes.
      if (pending[0].count > limit) {
        const [removed] = pending.splice(0, 1)
        placed.delete(removed.inputId)
        return removed.count
      }
      if (pending[0].count === 0) {
        for (let i = 1; i < pending.length; i++) {
          if (pending[i].count > limit) {
            const [removed] = pending.splice(i, 1)
            placed.delete(removed.inputId)
            return removed.count
          }
        }
      }
      return undefined
    }
    const overLimit = placedInOrder.find((entry) => entry.count > limit)
    // Several image-carrying inputs sharing one failed native response may
    // combine in the rejecting continuation (e.g. 1 + 2 = 3 images), so no
    // single entry's count is a reliable sent total. Retire all settled
    // inputs below but preserve the provider's limit text.
    const imageCarrying = placedInOrder.filter((entry) => entry.count > 0)
    const result = imageCarrying.length > 1 ? undefined : overLimit?.count
    const settledIds = new Set(placedInOrder.map((entry) => entry.inputId))
    for (let i = pending.length - 1; i >= 0; i--) {
      if (settledIds.has(pending[i].inputId)) pending.splice(i, 1)
    }
    for (const id of settledIds) placed.delete(id)
    return result
  }
  const placedEntries = pending.filter((entry) => placed.has(entry.inputId))
  if (placedEntries.length === 0) {
    const [entry] = pending.splice(0, 1)
    if (entry) placed.delete(entry.inputId)
    return entry?.count
  }
  const oldest = placedEntries[0].count
  const settledIds = new Set(placedEntries.map((entry) => entry.inputId))
  for (let i = pending.length - 1; i >= 0; i--) {
    if (settledIds.has(pending[i].inputId)) pending.splice(i, 1)
  }
  for (const id of settledIds) placed.delete(id)
  return oldest
}

/**
 * Convert a provider `result` failure into the typed image-limit error when
 * its text names an upstream cap. The result payload carries only the limit,
 * so the attached count comes from the last submitted turn. Returns
 * `undefined` for unrelated failures. Uses sent-aware wording because the
 * request was already sent.
 *
 * Exported for regression coverage: a provider result event carrying an image
 * cap must arrive as a typed `AgentImageLimitError`, not a generic
 * `ClaudeCodeResultError`.
 */
export function normalizeResultImageLimitFailure(
  failure: { message?: unknown } | string | unknown,
  lastImageCount: number | undefined
): AgentImageLimitError | undefined {
  if (lastImageCount === undefined) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? ((failure as { message?: string }).message as string)
          : undefined
  if (!message) return undefined
  return normalizeAgentImageLimitFailure(new Error(message), lastImageCount, {
    runtime: 'claude-code',
    sent: true
  })
}
