/**
 * Hand-written envelope validation. Both sides come from one build, so a malformed frame is a
 * packaging or implementation defect: guards are strict on required fields and ignore extras.
 * Child-safe.
 */

import { PROTOCOL, PROTOCOL_VERSION } from './constants'
import type { ChildFrame, ConnectFrame, FrameIdentity, LogLevel, MainFrame, RemoteErrorShape } from './frames'

const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Request ids are allocated by main, monotonically per generation, starting at 1. */
export function isRequestId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1
}

const isOptionalRequestId = (value: unknown): boolean => value === undefined || isRequestId(value)

export function isFrameIdentity(value: unknown): value is FrameIdentity & { kind: string } {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    value.version === PROTOCOL_VERSION &&
    typeof value.processId === 'string' &&
    Number.isInteger(value.generation) &&
    (value.generation as number) >= 1 &&
    typeof value.kind === 'string'
  )
}

/** Whether a (structurally valid) frame belongs to this process id and generation. */
export function matchesIdentity(frame: FrameIdentity, identity: FrameIdentity): boolean {
  return frame.processId === identity.processId && frame.generation === identity.generation
}

export function isRemoteError(value: unknown): value is RemoteErrorShape {
  if (!isRecord(value)) return false
  if (typeof value.name !== 'string' || typeof value.message !== 'string') return false
  if (value.stack !== undefined && typeof value.stack !== 'string') return false
  return value.code === undefined || typeof value.code === 'string' || typeof value.code === 'number'
}

export function isConnectFrame(value: unknown): value is ConnectFrame {
  return isFrameIdentity(value) && value.kind === 'connect' && 'initData' in value
}

export function isMainFrame(value: unknown): value is MainFrame {
  if (!isFrameIdentity(value)) return false
  const frame = value as unknown as Record<string, unknown>
  switch (frame.kind) {
    case 'request':
      return (
        isRequestId(frame.requestId) && typeof frame.method === 'string' && frame.method.length > 0 && 'input' in frame
      )
    case 'cancel':
      return isRequestId(frame.requestId)
    case 'shutdown':
      return true
    default:
      return false
  }
}

export function isChildFrame(value: unknown): value is ChildFrame {
  if (!isFrameIdentity(value)) return false
  const frame = value as unknown as Record<string, unknown>
  switch (frame.kind) {
    case 'ready':
      return true
    case 'event':
      return isRequestId(frame.requestId) && 'event' in frame
    case 'result':
      return isRequestId(frame.requestId) && 'output' in frame
    case 'error':
      return isRequestId(frame.requestId) && isRemoteError(frame.error)
    case 'startup-error':
      return isRemoteError(frame.error)
    case 'log':
      return (
        typeof frame.level === 'string' &&
        LOG_LEVELS.has(frame.level) &&
        typeof frame.message === 'string' &&
        (frame.fields === undefined || isRecord(frame.fields)) &&
        isOptionalRequestId(frame.requestId)
      )
    case 'protocol-error':
      return typeof frame.message === 'string' && isOptionalRequestId(frame.requestId)
    default:
      return false
  }
}
