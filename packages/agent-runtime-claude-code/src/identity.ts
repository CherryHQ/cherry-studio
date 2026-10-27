import { runtimeId, type BackendId, type RuntimeError, type Thread } from '@cherrystudio/agent-runtime'

import type { ClaudeCommandLifecycle } from './types'

export function isCommandLifecycle(value: unknown): value is ClaudeCommandLifecycle {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    event.type === 'command_lifecycle' &&
    typeof event.command_uuid === 'string' &&
    typeof event.uuid === 'string' &&
    typeof event.session_id === 'string' &&
    typeof event.state === 'string' &&
    ['queued', 'started', 'completed', 'cancelled', 'discarded', 'refused'].includes(event.state)
  )
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function isUuid(value: string): value is `${string}-${string}-${string}-${string}-${string}` {
  return uuid.test(value)
}

/** Construct a thread only from an established native session/agent identity. */
export function claudeThread(backendId: BackendId, sessionId: string, agentId?: string): Thread {
  if (!isUuid(sessionId) || (agentId !== undefined && !agentId)) throw new TypeError('Invalid Claude identity')
  return Object.freeze({
    backendId,
    id: runtimeId<'thread'>(agentId === undefined ? sessionId : `${sessionId}/${encodeURIComponent(agentId)}`)
  })
}

export function nativeIdentity(thread: Thread): { sessionId: string; agentId?: string } {
  const [sessionId, encoded, extra] = thread.id.split('/')
  if (!isUuid(sessionId) || extra !== undefined || encoded === '') throw new TypeError('Invalid Claude thread')
  const agentId = encoded === undefined ? undefined : decodeURIComponent(encoded)
  if (agentId !== undefined && encodeURIComponent(agentId) !== encoded) throw new TypeError('Invalid child identity')
  return { sessionId, agentId }
}

export function runtimeError(operation: string, code: string): RuntimeError {
  return { operation, code, message: `Claude Code ${operation}: ${code}` }
}

export function rejected(operation: string, code: string) {
  return { status: 'rejected' as const, error: runtimeError(operation, code) }
}
