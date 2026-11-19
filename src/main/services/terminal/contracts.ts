import type {
  TerminalResourceId,
  TerminalGeneration,
  TerminalConversationId,
  TerminalHostIdentity,
  TerminalContext,
  TerminalControl,
  TerminalRetention,
  TerminalStopReason,
  TerminalResourceState,
  TerminalCaptureRead,
  TerminalReceipt,
  TerminalViewFrame,
  GhosttyKeyInput,
  GhosttyMouseInput,
  GhosttyTheme
} from '@shared/types/terminal'
export type {
  TerminalResourceId,
  TerminalGeneration,
  TerminalConversationId,
  TerminalHostIdentity,
  TerminalContext,
  TerminalControl,
  TerminalProcessState,
  TerminalCleanup,
  TerminalRetention,
  TerminalStopReason,
  TerminalResourceState,
  TerminalCaptureRead,
  TerminalRejection,
  TerminalReceipt,
  TerminalViewFrame,
  GhosttyKeyInput,
  GhosttyMouseInput,
  GhosttyTheme
} from '@shared/types/terminal'
import path from 'node:path'

import * as z from 'zod'

import type {
  UtilityProcessMethod,
  UtilityProcessStreamFrame,
  UtilityProcessStreamMethod
} from '@main/core/utilityProcess/types'

export const terminalResourceId = z.uuid().transform((id) => id as TerminalResourceId)
export const terminalGeneration = z.uuid().transform((id) => id as TerminalGeneration)
export const terminalOperationId = z.string().min(1).max(96).brand<'TerminalOperationId'>()
export const terminalConversationId = z
  .string()
  .min(1)
  .max(512)
  .transform((id) => id as TerminalConversationId)
export type TerminalOperationId = z.infer<typeof terminalOperationId>

const text = z
  .string()
  .max(64 * 1024)
  .refine((value) => !value.includes('\0'), 'NUL is not allowed')
const commonLaunch = {
  shell: z.enum(['bash', 'powershell', 'zsh', 'other']),
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
  | {
      kind: 'input'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      data: string
      commandId?: string
      programRevision?: number
    }
  | {
      kind: 'interrupt'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      commandId: string
      programRevision: number
    }
  | {
      kind: 'shell-command'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      promptRevision: number
      commandId: string
      data: string
    }
  | {
      kind: 'key'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      event: GhosttyKeyInput
      geometryEpoch: number
    }
  | {
      kind: 'paste'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      data: string
      geometryEpoch: number
    }
  | {
      kind: 'wheel'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      geometryEpoch: number
      event: GhosttyMouseInput
      rows: number
    }
  | {
      kind: 'mouse'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      geometryEpoch: number
      event: GhosttyMouseInput
    }
  | {
      kind: 'resize'
      id: TerminalResourceId
      actor: TerminalActor
      controlRevision: number
      cols: number
      rows: number
      geometryEpoch?: number
      cellWidth?: number
      cellHeight?: number
    }

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
  admissionRevision?: number
  host: TerminalHostIdentity
  helperFile: string
  integrationDirectory?: string
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
    view: UtilityProcessMethod<
      {
        host: TerminalHostIdentity
        id: TerminalResourceId
        viewId: string
        rowStart: number
        offset: number
        revision: number | null
        theme?: GhosttyTheme
      },
      TerminalViewFrame
    >
    detachView: UtilityProcessMethod<{ host: TerminalHostIdentity; id: TerminalResourceId; viewId: string }, void>
    link: UtilityProcessMethod<
      {
        host: TerminalHostIdentity
        id: TerminalResourceId
        viewId: string
        revision: number
        geometryEpoch: number
        x: number
        y: number
      },
      string | null
    >
    release: UtilityProcessMethod<{ host: TerminalHostIdentity; id: TerminalResourceId }, boolean>
    seal: UtilityProcessMethod<{ host: TerminalHostIdentity; admissionRevision: number }, TerminalResourceState[]>
  }
  streams: { observe: UtilityProcessStreamMethod<TerminalHostIdentity, never, UtilityProcessStreamFrame, void> }
}
