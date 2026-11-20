import * as z from 'zod'

import type { TerminalReceipt, TerminalResourceView, TerminalViewFrame } from '@shared/types/terminal'
import { workspaceUsageRecordSchema } from '@shared/types/workspaceUsage'

import { defineRoute } from '../define'

const ref = z
  .object({ host: z.object({ conversationId: z.string().min(1).max(512), generation: z.uuid() }), id: z.uuid() })
  .strict()
const revision = z.number().int().nonnegative()
const text = z
  .string()
  .max(64 * 1024)
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 60 * 1024,
    'Terminal input exceeds the frame byte budget'
  )
const channel = z.number().int().min(0).max(255)
const color = z.object({ r: channel, g: channel, b: channel }).strict()
const theme = z
  .object({
    foreground: color,
    background: color,
    cursor: color,
    cursorStyle: z.enum(['block', 'bar', 'underline']).optional(),
    cursorBlink: z.boolean().optional()
  })
  .strict()
const key = z
  .object({
    key: z.number().int().min(0).max(512),
    mods: z.number().int().min(0).max(255),
    consumedMods: z.number().int().min(0).max(255),
    composing: z.boolean(),
    unshiftedCodepoint: z.number().int().min(0).max(0x10ffff),
    text,
    repeat: z.boolean()
  })
  .strict()
const mouse = z
  .object({
    action: z.enum(['press', 'release', 'motion']),
    button: z.number().int().min(0).max(11).nullable(),
    mods: z.number().int().min(0).max(255),
    x: z.number().finite().min(0).max(65536),
    y: z.number().finite().min(0).max(65536),
    screenWidth: z.number().finite().positive().max(65536),
    screenHeight: z.number().finite().positive().max(65536),
    cellWidth: z.number().finite().positive().max(256),
    cellHeight: z.number().finite().positive().max(256),
    paddingLeft: z.number().min(0).max(256),
    paddingRight: z.number().min(0).max(256),
    paddingTop: z.number().min(0).max(256),
    paddingBottom: z.number().min(0).max(256),
    anyButtonPressed: z.boolean()
  })
  .strict()
export const terminalViewAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wheel'),
    rows: z.number().int().min(-30).max(30),
    geometryEpoch: revision,
    event: mouse
  }),
  z.object({ kind: z.literal('take-control') }),
  z.object({ kind: z.literal('return-control') }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('paste'), data: text, geometryEpoch: revision }),
  z.object({ kind: z.literal('key'), event: key, geometryEpoch: revision }),
  z.object({ kind: z.literal('mouse'), event: mouse, geometryEpoch: revision }),
  z.object({
    kind: z.literal('resize'),
    cols: z.number().int().min(2).max(256),
    rows: z.number().int().min(2).max(80),
    cellWidth: z.number().positive().max(256),
    cellHeight: z.number().positive().max(256),
    geometryEpoch: revision
  })
])
export const terminalRequestSchemas = {
  'terminal.cleanup.status': defineRoute({
    input: z.object({}).strict(),
    output: z.object({ count: revision, recoveryFailed: z.boolean() })
  }),
  'terminal.cleanup.list': defineRoute({
    input: z.object({}).strict(),
    output: z.array(workspaceUsageRecordSchema).max(4096)
  }),
  'terminal.cleanup.retry': defineRoute({
    input: z.object({ id: z.uuid() }).strict(),
    output: z.object({ status: z.enum(['confirmed', 'unconfirmed', 'unavailable']) })
  }),
  'terminal.list': defineRoute({
    input: z.object({ sessionId: z.string().min(1).max(512), selectedId: z.uuid().optional() }).strict(),
    output: z.custom<{ resources: TerminalResourceView[]; truncated: boolean }>()
  }),
  'terminal.create': defineRoute({
    input: z
      .object({
        sessionId: z.string().min(1).max(512),
        shell: z.enum(['default', 'bash', 'powershell']),
        operationId: z.uuid()
      })
      .strict(),
    output: z.custom<TerminalReceipt>()
  }),
  'terminal.read': defineRoute({
    input: z.object({ ref, cursor: revision }).strict(),
    output: z.object({ start: revision, next: revision, end: revision, truncated: z.boolean(), output: z.string() })
  }),
  'terminal.attach': defineRoute({ input: ref, output: z.string() }),
  'terminal.frame': defineRoute({
    input: z
      .object({
        viewId: z.uuid(),
        rowStart: z.number().int().min(0).max(128),
        offset: z.number().int().min(0).max(5000),
        revision: revision.nullable(),
        theme: theme.optional()
      })
      .strict(),
    output: z.custom<TerminalViewFrame>()
  }),
  'terminal.detach': defineRoute({ input: z.object({ viewId: z.uuid() }).strict(), output: z.void() }),
  'terminal.link': defineRoute({
    input: z
      .object({
        viewId: z.uuid(),
        revision,
        geometryEpoch: revision,
        x: z.number().int().min(0).max(511),
        y: z.number().int().min(0).max(127)
      })
      .strict(),
    output: z.string().nullable()
  }),
  'terminal.action': defineRoute({
    input: z
      .object({ viewId: z.uuid(), operationId: z.uuid(), controlRevision: revision, action: terminalViewAction })
      .strict(),
    output: z.custom<TerminalReceipt>()
  }),
  'terminal.promote': defineRoute({
    input: z.object({ ref, operationId: z.uuid(), cancelRevision: revision }).strict(),
    output: z.custom<TerminalReceipt>()
  }),
  'terminal.stop': defineRoute({
    input: z.object({ ref, operationId: z.uuid(), controlRevision: revision, cancelRevision: revision }).strict(),
    output: z.custom<TerminalReceipt>()
  })
}
