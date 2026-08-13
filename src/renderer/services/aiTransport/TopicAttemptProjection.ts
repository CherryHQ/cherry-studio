import { type AttemptDescriptor, type AttemptId, type SlotKey, slotKey, toAttemptId } from '@shared/ai/attempt'
import type { ActiveExecution } from '@shared/ai/transport'

export interface RendererAttempt {
  descriptor: AttemptDescriptor
  phase: 'active' | 'settled'
}

export interface ProjectionRegistration {
  accepted: boolean
  replaced?: RendererAttempt
  replacedUnsettled: boolean
}

function descriptorFor(topicId: string, execution: ActiveExecution): AttemptDescriptor {
  return {
    topicId,
    executionId: execution.executionId,
    attemptId: toAttemptId(execution.attemptId),
    anchorMessageId: execution.anchorMessageId ?? null
  }
}

/** Per-window projection for one topic. Main remains authoritative; this only
 * reconciles delayed snapshots, replayed terminals, and same-slot replacement. */
export class TopicStreamProjection {
  readonly attempts = new Map<AttemptId, RendererAttempt>()
  #activeBySlot = new Map<SlotKey, AttemptId>()
  #watermark: AttemptId | undefined

  constructor(readonly topicId: string) {}

  get watermark(): AttemptId | undefined {
    return this.#watermark
  }

  register(execution: ActiveExecution): ProjectionRegistration {
    const descriptor = descriptorFor(this.topicId, execution)
    const existing = this.attempts.get(descriptor.attemptId)
    if (existing) return { accepted: existing.phase === 'active', replacedUnsettled: false }
    if (this.isSettled(descriptor.attemptId)) {
      this.attempts.set(descriptor.attemptId, { descriptor, phase: 'settled' })
      return { accepted: false, replacedUnsettled: false }
    }

    const key = slotKey(descriptor)
    const currentId = this.#activeBySlot.get(key)
    const current = currentId === undefined ? undefined : this.attempts.get(currentId)
    if (current && current.descriptor.attemptId > descriptor.attemptId) {
      this.attempts.set(descriptor.attemptId, { descriptor, phase: 'settled' })
      return { accepted: false, replacedUnsettled: false }
    }

    let replaced: RendererAttempt | undefined
    let replacedUnsettled = false
    if (current && current.descriptor.attemptId < descriptor.attemptId) {
      replaced = current
      replacedUnsettled = current.phase === 'active'
      current.phase = 'settled'
    }

    const next: RendererAttempt = { descriptor, phase: 'active' }
    this.attempts.set(descriptor.attemptId, next)
    this.#activeBySlot.set(key, descriptor.attemptId)
    return { accepted: true, replaced, replacedUnsettled }
  }

  settle(execution: Pick<ActiveExecution, 'executionId' | 'attemptId' | 'anchorMessageId'>): void {
    const attemptId = toAttemptId(execution.attemptId)
    const descriptor: AttemptDescriptor = {
      topicId: this.topicId,
      executionId: execution.executionId,
      attemptId,
      anchorMessageId: execution.anchorMessageId ?? null
    }
    const attempt = this.attempts.get(attemptId) ?? { descriptor, phase: 'active' as const }
    attempt.phase = 'settled'
    this.attempts.set(attemptId, attempt)
    const key = slotKey(attempt.descriptor)
    if (this.#activeBySlot.get(key) === attemptId) this.#activeBySlot.delete(key)
  }

  advanceWatermark(value: number): void {
    const watermark = toAttemptId(value)
    if (this.#watermark !== undefined && watermark <= this.#watermark) return
    this.#watermark = watermark
    for (const [attemptId, attempt] of this.attempts) {
      if (attemptId > watermark) continue
      attempt.phase = 'settled'
      const key = slotKey(attempt.descriptor)
      if (this.#activeBySlot.get(key) === attemptId) this.#activeBySlot.delete(key)
    }
  }

  isSettled(value: number): boolean {
    const attemptId = toAttemptId(value)
    return (
      (this.#watermark !== undefined && attemptId <= this.#watermark) ||
      this.attempts.get(attemptId)?.phase === 'settled'
    )
  }
}

/** The one renderer rule for delayed active-execution snapshots: within a
 * model+anchor slot, the greatest attempt id wins while source order stays stable. */
export function projectActiveExecutions(...sources: ReadonlyArray<readonly ActiveExecution[]>): ActiveExecution[] {
  const order: SlotKey[] = []
  const bySlot = new Map<SlotKey, ActiveExecution>()

  for (const executions of sources) {
    for (const execution of executions) {
      const key = slotKey({ executionId: execution.executionId, anchorMessageId: execution.anchorMessageId ?? null })
      const current = bySlot.get(key)
      if (!current) order.push(key)
      if (current && current.attemptId > execution.attemptId) continue
      bySlot.set(key, execution)
    }
  }

  return order.flatMap((key) => {
    const execution = bySlot.get(key)
    return execution ? [execution] : []
  })
}
