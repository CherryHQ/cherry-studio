import path from 'node:path'

import * as z from 'zod'

import type {
  UtilityProcessMethod,
  UtilityProcessStreamFrame,
  UtilityProcessStreamMethod
} from '@main/core/utilityProcess/types'

export const terminalResourceId = z.uuid().brand<'TerminalResourceId'>()
export const terminalGeneration = z.uuid().brand<'TerminalGeneration'>()
export const terminalOperationId = z.string().min(1).max(96).brand<'TerminalOperationId'>()
export const terminalConversationId = z.string().min(1).max(512).brand<'TerminalConversationId'>()
export type TerminalResourceId = z.infer<typeof terminalResourceId>
export type TerminalGeneration = z.infer<typeof terminalGeneration>
export type TerminalOperationId = z.infer<typeof terminalOperationId>
export type TerminalConversationId = z.infer<typeof terminalConversationId>

export interface TerminalHostIdentity {
  conversationId: TerminalConversationId
  generation: TerminalGeneration
}

export interface TerminalContext {
  contextId: string
  bindingId: string
  revision: number
}

const text = z
  .string()
  .max(64 * 1024)
  .refine((value) => !value.includes('\0'), 'NUL is not allowed')
const commonLaunch = {
  shell: z.enum(['bash', 'powershell']),
  file: text.min(1).refine(path.isAbsolute, 'Executable must be absolute'),
  args: z.array(text).max(256),
  cwd: text.min(1).refine(path.isAbsolute, 'Working directory must be absolute'),
  env: z
    .record(
      z
        .string()
        .min(1)
        .max(256)
        .refine((key) => !key.includes('\0') && !key.includes('=')),
      text
    )
    .transform((env) => Object.fromEntries(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
}
export const terminalLaunch = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('pipe'),
      ...commonLaunch,
      stdin: z
        .string()
        .max(512 * 1024)
        .default(''),
      deadlineAt: z.number().finite().optional()
    }),
    z.object({
      kind: z.literal('pty'),
      ...commonLaunch,
      cols: z.number().int().min(2).max(512),
      rows: z.number().int().min(2).max(128)
    })
  ])
  .refine(
    (launch) => Buffer.byteLength(JSON.stringify(launch)) <= 1024 * 1024,
    'Terminal launch exceeds the byte budget'
  )
export type TerminalLaunch = z.infer<typeof terminalLaunch>

export type TerminalControl = { kind: 'unassigned' } | { kind: 'agent'; context: TerminalContext } | { kind: 'user' }
export type TerminalProcessState =
  | { kind: 'not_started' | 'starting' | 'running' | 'closing' }
  | { kind: 'exited'; exitCode: number | null; signal: number | null }
  | { kind: 'lost'; message: string }
export type TerminalCleanup = 'none' | 'pending' | 'confirmed' | 'unconfirmed'
export type TerminalRetention = { kind: 'turn'; turnId: string } | { kind: 'session' }
export type TerminalStopReason =
  | 'agent_stop'
  | 'task_stop'
  | 'terminal_close'
  | 'runtime_released'
  | 'deadline'
  | 'user'
  | 'conversation_closed'
  | 'host_stopped'
  | 'root_exited'
export interface TerminalResourceState {
  id: TerminalResourceId
  host: TerminalHostIdentity
  kind: 'pipe' | 'pty'
  shell: 'bash' | 'powershell'
  context: TerminalContext
  process: TerminalProcessState
  cleanup: TerminalCleanup
  retention: TerminalRetention
  cancelRevision: number
  control: TerminalControl
  controlRevision: number
  revision: number
  outputCursor: number
  stopReason?: TerminalStopReason
}

export interface TerminalCaptureRead {
  start: number
  next: number
  end: number
  truncated: boolean
  data: Uint8Array
}

export type TerminalActor = { kind: 'agent'; context: TerminalContext } | { kind: 'user' }
export type TerminalCommand =
  | { kind: 'bind'; context: TerminalContext }
  | { kind: 'release-context'; context: TerminalContext; nextRevision: number }
  | {
      kind: 'start'
      id: TerminalResourceId
      context: TerminalContext
      retention: TerminalRetention
      launch: TerminalLaunch
    }
  | { kind: 'promote'; id: TerminalResourceId; context: TerminalContext; cancelRevision: number }
  | {
      kind: 'stop'
      id: TerminalResourceId
      actor: TerminalActor
      cancelRevision: number
      controlRevision: number
      reason: TerminalStopReason
    }
  | { kind: 'control'; id: TerminalResourceId; actor: TerminalActor; controlRevision: number; target: TerminalControl }
  | { kind: 'input'; id: TerminalResourceId; actor: TerminalActor; controlRevision: number; data: string }
  | {
      kind: 'resize'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      cols: number
      rows: number
    }

export type TerminalRejection =
  | 'stale_context'
  | 'stale_generation'
  | 'stale_control'
  | 'closing'
  | 'capacity_exceeded'
  | 'identity_conflict'
  | 'outcome_unknown'
  | 'unsupported'
  | 'busy'
export type TerminalReceipt =
  | { kind: 'resource'; resource: TerminalResourceState }
  | { kind: 'context'; context: TerminalContext }
  | { kind: 'rejected'; reason: TerminalRejection }
export interface TerminalMutation {
  host: TerminalHostIdentity
  admissionRevision: number
  operation: { id: TerminalOperationId; sequence: number }
  command: TerminalCommand
}
export type TerminalOperation =
  | { kind: 'pending' }
  | { kind: 'settled'; receipt: TerminalReceipt }
  | { kind: 'outcome_unknown' }
export interface TerminalHostInit {
  host: TerminalHostIdentity
  helperFile: string
  ghosttyDirectory: string
}
export type TerminalHostContract = {
  methods: {
    identity: UtilityProcessMethod<void, TerminalHostIdentity>
    mutate: UtilityProcessMethod<TerminalMutation, TerminalReceipt>
    operation: UtilityProcessMethod<{ host: TerminalHostIdentity; id: TerminalOperationId }, TerminalOperation>
    read: UtilityProcessMethod<
      { host: TerminalHostIdentity; id: TerminalResourceId; cursor: number; limit: number },
      TerminalCaptureRead
    >
    release: UtilityProcessMethod<{ host: TerminalHostIdentity; id: TerminalResourceId }, boolean>
    seal: UtilityProcessMethod<{ host: TerminalHostIdentity; admissionRevision: number }, TerminalResourceState[]>
  }
  streams: { observe: UtilityProcessStreamMethod<TerminalHostIdentity, never, UtilityProcessStreamFrame, void> }
}
