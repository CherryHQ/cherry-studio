import { Context } from '@deepseek-ai/cordis'
import { Inbox } from '@deepseek-ai/dsh-agent'
import {
  deriveEventMessage,
  foldSurface,
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
  events?: unknown[]
}

export function readForkContext(input: { events: SessionEvent[]; boundary: number }) {
  const events = input.events.slice(0, input.boundary + 1)
  if (
    events.length !== input.boundary + 1 ||
    events.at(-1)?.type !== 'turn/end' ||
    events.at(-1)?.seq !== input.boundary ||
    interruptedTurnClosers(events).length
  )
    throw new Error('history_corrupt')
  const surface = foldSurface(events)
  if (!surface.replacements.length) return undefined
  return {
    identity: String(surface.replacements.at(-1)!.seq),
    messages: surface.nodes.flatMap((seq) => {
      const message = deriveEventMessage(events[seq])
      return message ? [message] : []
    })
  }
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
    if (
      events.length !== input.boundary + 1 ||
      events.at(-1)?.seq !== input.boundary ||
      events.at(-1)?.type !== 'turn/end'
    )
      throw new Error('history_changed')
    if (interruptedTurnClosers(events).length) throw new Error('history_corrupt')
    // SessionStore validates and owns a detached copy of the full event graph.
    const child = target.sessions.create(SessionId(input.targetSessionId), {
      seed: events,
      inheritedEventCount: SessionLogOffset(events.length),
      meta: { cwd: input.targetCwd, parentSession: SessionId(input.sourceSessionId), isSeeded: true }
    })
    const inbox = new Inbox(child, { inserted() {}, discarded() {}, claimed() {} })
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
