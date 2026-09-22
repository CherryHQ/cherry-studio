/**
 * Frame shapes for the private MessagePort between main and a utility process.
 * Child-safe: types only.
 */

import type { PROTOCOL, PROTOCOL_VERSION } from './constants'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Stamped on every frame in both directions so a foreign or stale frame is a detectable violation. */
export interface FrameIdentity {
  protocol: typeof PROTOCOL
  version: typeof PROTOCOL_VERSION
  processId: string
  generation: number
}

/** The clone-safe subset of an Error the child sends back; arbitrary `cause`/`data` graphs are not carried. */
export interface RemoteErrorShape {
  name: string
  message: string
  stack?: string
  code?: string | number
}

/** Bootstrap frame: the only message ever sent over `process.parentPort`; transfers the private port. */
export type ConnectFrame = FrameIdentity & { kind: 'connect'; initData: unknown }

export type RequestFrame = FrameIdentity & { kind: 'request'; requestId: number; method: string; input: unknown }
export type CancelFrame = FrameIdentity & { kind: 'cancel'; requestId: number }
export type ShutdownFrame = FrameIdentity & { kind: 'shutdown' }
export type MainFrame = RequestFrame | CancelFrame | ShutdownFrame

export type ReadyFrame = FrameIdentity & { kind: 'ready' }
export type EventFrame = FrameIdentity & { kind: 'event'; requestId: number; event: unknown }
export type ResultFrame = FrameIdentity & { kind: 'result'; requestId: number; output: unknown }
export type ErrorFrame = FrameIdentity & { kind: 'error'; requestId: number; error: RemoteErrorShape }
export type StartupErrorFrame = FrameIdentity & { kind: 'startup-error'; error: RemoteErrorShape }
export type LogFrame = FrameIdentity & {
  kind: 'log'
  level: LogLevel
  message: string
  fields?: Record<string, unknown>
  requestId?: number
}
export type ProtocolErrorFrame = FrameIdentity & { kind: 'protocol-error'; message: string; requestId?: number }
export type ChildFrame =
  | ReadyFrame
  | EventFrame
  | ResultFrame
  | ErrorFrame
  | StartupErrorFrame
  | LogFrame
  | ProtocolErrorFrame

/** A frame with its identity stripped — what each side fills in before stamping. */
export type Unstamped<F extends FrameIdentity> = F extends unknown ? Omit<F, keyof FrameIdentity> : never
