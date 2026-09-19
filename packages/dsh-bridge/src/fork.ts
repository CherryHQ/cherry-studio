import { createHash } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'
import { Inbox } from '@deepseek-ai/dsh-agent'
import {
  interruptedTurnClosers,
  type SessionEvent,
  SessionId,
  SessionLogOffset,
  SessionStore
} from '@deepseek-ai/dsh-session'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'

export interface DshForkInput {
  sourceRoot: string
  targetRoot: string
  sourceSessionId: string
  targetSessionId: string
  targetCwd: string
  boundary: number
  checkpoints: Array<{ boundary: number }>
  events?: unknown[]
}

export function createForkCheckpoint(events: readonly SessionEvent[], boundary: number) {
  const prefix = events.slice(0, boundary + 1)
  if (
    !Number.isSafeInteger(boundary) ||
    boundary < 0 ||
    prefix.length !== boundary + 1 ||
    prefix.at(-1)?.type !== 'turn/end' ||
    prefix.at(-1)?.seq !== boundary
  )
    throw new Error('history_changed')
  if (prefix.some((event, index) => event.seq !== index) || interruptedTurnClosers(prefix).length)
    throw new Error('history_corrupt')
  // Canonical keys make live snapshots and decoded JSONL independent of object insertion order.
  const canonical = JSON.stringify(prefix, (_key, value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  )
  return { boundary, prefixHash: createHash('sha256').update(canonical).digest('hex') }
}

/** This context deliberately has no Agent, loop, tools, goals or subagent services. */
export async function forkSession(input: DshForkInput): Promise<{ path: string }> {
  const source = new Context()
  const target = new Context()
  try {
    await source.plugin(SessionStore)
    await source.plugin(JsonlSessionPersistence, { root: input.sourceRoot })
    await target.plugin(SessionStore)
    await target.plugin(JsonlSessionPersistence, { root: input.targetRoot })
    const stored = input.events
      ? undefined
      : await (source.sessionPersistence as JsonlSessionPersistence).loadStored(SessionId(input.sourceSessionId))
    const events = (input.events ?? stored?.events)?.slice(0, input.boundary + 1) as SessionEvent[] | undefined
    if (!events) throw new Error('history_missing')
    const { prefixHash } = createForkCheckpoint(events, input.boundary)
    for (const checkpoint of input.checkpoints) {
      createForkCheckpoint(events, checkpoint.boundary)
    }
    // SessionStore validates and owns a detached copy of the full event graph.
    const child = target.sessions.create(SessionId(input.targetSessionId), {
      seed: events,
      inheritedEventCount: SessionLogOffset(events.length),
      meta: { cwd: input.targetCwd, isSeeded: true }
    })
    const inbox = new Inbox(child, { inserted() {}, discarded() {}, claimed() {} })
    if (createForkCheckpoint(child.snapshotEvents(), input.boundary).prefixHash !== prefixHash)
      throw new Error('history_corrupt')
    // 0.1.2's durable end-seed marker already excludes inherited inbox events.
    // Also clear any child-owned setup input through the public mutation API.
    inbox.clear()
    if (inbox.hasPending || child.header.cwd !== input.targetCwd || child.id !== input.targetSessionId) {
      throw new Error('history_corrupt')
    }
    await target.sessionPersistence.ensureMaterialized(child)
    await target.sessions.flush(child)
    const location = target.sessionPersistence.locate(child.header)
    if (!location?.path) throw new Error('Unsupported DSH storage')
    return { path: location.path }
  } finally {
    await Promise.all([target.fiber.dispose(), source.fiber.dispose()])
  }
}
