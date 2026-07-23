import { performance } from 'node:perf_hooks'

import { loggerService } from '@logger'
import type {
  PrepareProgressPartData,
  PrepareStageDetail,
  PrepareTimeline,
  PrepareTimelineStage,
  PrepareTimelineStageEntry
} from '@shared/ai/agentPrepareTimeline'
import { PREPARE_TIMELINE_FOOTER_THRESHOLD_MS, stageToPhase } from '@shared/ai/agentPrepareTimeline'

const logger = loggerService.withContext('PrepareTimelineRecorder')

/** Live coarse-phase sink — the host forwards each update to the current turn's stream (or drops it). */
export type PrepareProgressSink = (update: PrepareProgressPartData) => void

export interface PrepareTimelineRecorderContext {
  sessionId: string
  agentId: string
  runtimeType: string
}

/**
 * Records the per-turn "prepare response" timeline as `performance.now()` offsets. Stages tile the
 * window contiguously — {@link begin} closes the previously open stage — so `totalMs` is exactly the
 * sum of the recorded stages. Emits a coarse live phase as each stage opens to the turn-owned
 * transport gate. On {@link finalize}, it always notifies that gate so the live-delay timer can be
 * cleared, but writes a structured log only when the timeline exceeds the footer threshold.
 *
 * Runtime-agnostic: it knows nothing about claude-code; a driver drives it via `begin`/`patch`/
 * `finalize`. `now` is injectable on every method purely for deterministic tests.
 */
export class PrepareTimelineRecorder {
  private readonly stages: PrepareTimelineStageEntry[] = []
  private openStage?: { stage: PrepareTimelineStage; detail?: PrepareStageDetail }
  private markAt: number
  private progressSink?: PrepareProgressSink
  private finalized = false
  private mcpServerNames: string[] = []

  constructor(
    private readonly context: PrepareTimelineRecorderContext,
    private readonly startedAt: number = performance.now(),
    onStage?: PrepareProgressSink
  ) {
    this.markAt = startedAt
    this.progressSink = onStage
  }

  /** Replace the live sink when a reusable connection admits its next turn. */
  setProgressSink(onStage: PrepareProgressSink): void {
    if (!this.finalized) this.progressSink = onStage
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
   * Close any open stage and build the timeline. The sink always receives finalization so its delayed
   * live-progress timer cannot outlive a fast prepare; that sink owns transport filtering. Structured
   * logging remains slow-only. Returns undefined after the first call.
   */
  finalize(now: number = performance.now()): PrepareTimeline | undefined {
    if (this.finalized) return undefined
    this.closeOpen(now)
    this.finalized = true
    const timeline = this.buildTimeline(now)
    this.progressSink?.({ phase: 'waiting-first-response', timeline })
    if (timeline.totalMs > PREPARE_TIMELINE_FOOTER_THRESHOLD_MS) {
      logger.info('agent turn prepare timeline', {
        sessionId: this.context.sessionId,
        agentId: this.context.agentId,
        runtimeType: this.context.runtimeType,
        totalMs: timeline.totalMs,
        stages: timeline.stages
      })
    }
    return timeline
  }

  get isFinalized(): boolean {
    return this.finalized
  }

  get currentStage(): PrepareTimelineStage | undefined {
    return this.openStage?.stage
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

  private buildTimeline(now: number): PrepareTimeline {
    const totalMs = round(Math.max(0, now - this.startedAt))
    const stages = this.stages.map((stage) => ({ ...stage }))
    // Durations are rounded independently for display. Assign the rounding remainder to the final
    // contiguous stage so diagnostics still add up exactly to the observed wall-clock window.
    let remainder = totalMs - stages.reduce((sum, entry) => sum + entry.ms, 0)
    for (let index = stages.length - 1; remainder !== 0 && index >= 0; index -= 1) {
      const adjustment = remainder < 0 ? Math.max(remainder, -stages[index].ms) : remainder
      stages[index].ms += adjustment
      remainder -= adjustment
    }
    return {
      totalMs,
      stages,
      runtimeType: this.context.runtimeType,
      ...(this.mcpServerNames.length > 0 ? { mcpServerNames: this.mcpServerNames } : {})
    }
  }

  private emit(stage: PrepareTimelineStage, detail?: PrepareStageDetail): void {
    if (!this.progressSink) return
    const phase = stageToPhase(stage)
    const update: PrepareProgressPartData = { phase }
    if (phase === 'connecting-mcp' && detail?.mcpServerName) update.mcpServerName = detail.mcpServerName
    this.progressSink(update)
  }
}

function round(value: number): number {
  return Math.round(value)
}
