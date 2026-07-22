import { performance } from 'node:perf_hooks'

import { loggerService } from '@logger'
import type {
  PrepareProgressPartData,
  PrepareStageDetail,
  PrepareTimeline,
  PrepareTimelineStage,
  PrepareTimelineStageEntry
} from '@shared/ai/agentPrepareTimeline'
import { stageToPhase } from '@shared/ai/agentPrepareTimeline'

const logger = loggerService.withContext('PrepareTimelineRecorder')

/** Live coarse-phase sink — the host forwards each update to the current turn's stream (or drops it). */
export type PrepareProgressSink = (update: PrepareProgressPartData) => void

export interface PrepareTimelineRecorderContext {
  sessionId: string
  agentId: string
  runtimeType: string
  onStage?: PrepareProgressSink
}

/**
 * Records the per-turn "prepare response" timeline as `performance.now()` offsets. Stages tile the
 * window contiguously — {@link begin} closes the previously open stage — so `totalMs` is exactly the
 * sum of the recorded stages. Emits a coarse live phase as each stage opens (for the placeholder
 * label) and, on {@link finalize}, the full breakdown (for the footer) plus one structured log.
 *
 * Runtime-agnostic: it knows nothing about claude-code; a driver drives it via `begin`/`patch`/
 * `finalize`. `now` is injectable on every method purely for deterministic tests.
 */
export class PrepareTimelineRecorder {
  private readonly stages: PrepareTimelineStageEntry[] = []
  private openStage?: { stage: PrepareTimelineStage; detail?: PrepareStageDetail }
  private markAt: number
  private finalized = false
  private mcpServerNames: string[] = []

  constructor(
    private readonly context: PrepareTimelineRecorderContext,
    now: number = performance.now()
  ) {
    this.markAt = now
  }

  /**
   * Record the `dispatch` stage that elapsed before this recorder existed (host turn-stream open →
   * driver connect start). No-op for a non-positive span (e.g. a prime connect with no waiting turn).
   */
  recordDispatch(elapsedMs: number): void {
    if (this.finalized || elapsedMs <= 0) return
    this.stages.push({ stage: 'dispatch', ms: round(elapsedMs) })
  }

  /** Open a stage: closes the previously open one, then emits its coarse phase live. */
  begin(stage: PrepareTimelineStage, detail?: PrepareStageDetail, now: number = performance.now()): void {
    if (this.finalized) return
    this.closeOpen(now)
    this.openStage = { stage, detail }
    this.markAt = now
    this.emit(stage, detail)
  }

  /** Merge detail into the currently open stage (e.g. `completedInTime` learned after the await). */
  patch(detail: PrepareStageDetail): void {
    if (this.finalized || !this.openStage) return
    this.openStage.detail = { ...this.openStage.detail, ...detail }
    // A patched MCP-warm server name should update the live label too.
    this.emit(this.openStage.stage, this.openStage.detail)
  }

  /** Close the open stage without opening a new one (e.g. init before the host sends the message). */
  end(now: number = performance.now()): void {
    if (this.finalized) return
    this.closeOpen(now)
  }

  setMcpServerNames(names: string[]): void {
    this.mcpServerNames = names
  }

  /**
   * Close any open stage, build the timeline, emit the finalized progress part and log it once.
   * Returns the timeline (undefined if already finalized). Idempotent.
   */
  finalize(now: number = performance.now()): PrepareTimeline | undefined {
    if (this.finalized) return undefined
    this.closeOpen(now)
    this.finalized = true
    const timeline = this.buildTimeline()
    this.context.onStage?.({ phase: 'waiting-first-response', timeline })
    logger.info('agent turn prepare timeline', {
      sessionId: this.context.sessionId,
      agentId: this.context.agentId,
      runtimeType: this.context.runtimeType,
      totalMs: timeline.totalMs,
      stages: timeline.stages
    })
    return timeline
  }

  get isFinalized(): boolean {
    return this.finalized
  }

  private closeOpen(now: number): void {
    if (!this.openStage) return
    this.stages.push({
      stage: this.openStage.stage,
      ms: round(Math.max(0, now - this.markAt)),
      ...(this.openStage.detail ? { detail: this.openStage.detail } : {})
    })
    this.openStage = undefined
  }

  private buildTimeline(): PrepareTimeline {
    const totalMs = this.stages.reduce((sum, entry) => sum + entry.ms, 0)
    return {
      totalMs: round(totalMs),
      stages: this.stages,
      runtimeType: this.context.runtimeType,
      ...(this.mcpServerNames.length > 0 ? { mcpServerNames: this.mcpServerNames } : {})
    }
  }

  private emit(stage: PrepareTimelineStage, detail?: PrepareStageDetail): void {
    if (!this.context.onStage) return
    const phase = stageToPhase(stage)
    const update: PrepareProgressPartData = { phase }
    if (phase === 'connecting-mcp' && detail?.mcpServerName) update.mcpServerName = detail.mcpServerName
    this.context.onStage(update)
  }
}

function round(value: number): number {
  return Math.round(value)
}
