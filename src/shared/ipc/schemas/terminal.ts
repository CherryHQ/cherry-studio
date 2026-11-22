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
const point = z.object({ x: revision, y: revision })
const block = z.object({
  outputEmpty: z.boolean(),
  id: z.string().max(128),
  contentRevision: revision,
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  status: z.enum(['running', 'completed', 'unknown']),
  exitCode: z.number().nullable(),
  reliable: z.boolean(),
  prompt: point.nullable(),
  output: point.nullable(),
  end: point.nullable()
})
export const terminalBlockReadInput = z.object({
  blockId: z.string().min(1).max(128),
  part: z.enum(['command', 'output', 'block']),
  consistency: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('latest') }),
    z.object({ kind: z.literal('exact'), contentRevision: revision })
  ])
})
export const terminalSearchInput = z.object({
  queryRevision: revision,
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('terminal') }),
    z.object({ kind: z.literal('block'), blockId: z.string().min(1).max(128) })
  ]),
  needle: z.string().refine((value) => new TextEncoder().encode(value).length <= 4096)
})
export const terminalSearchProjection = z.object({
  queryRevision: revision,
  resultRevision: revision,
  status: z.enum(['searching', 'caught-up', 'limited', 'unavailable', 'capacity', 'failed']),
  count: revision,
  selected: z.object({ index: revision, range: z.object({ start: point, end: point }).nullable() }).nullable(),
  matches: z.array(z.object({ start: point, end: point })).max(2000),
  highlightsLimited: z.boolean(),
  partial: z.boolean()
})
export const terminalViewLayout = z.object({
  revision,
  sourceRevision: revision,
  geometryEpoch: revision,
  spans: z
    .array(z.object({ sourceStart: revision, count: z.number().int().min(1).max(128), targetStart: revision }))
    .max(128)
})
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
  z.object({
    kind: z.literal('rerun'),
    blockId: z.string().min(1).max(128),
    contentRevision: revision,
    promptRevision: revision,
    draftRevision: revision
  }),
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
        theme: theme.optional(),
        layout: terminalViewLayout.optional()
      })
      .strict(),
    output: z.custom<TerminalViewFrame>()
  }),
  'terminal.blocks.list': defineRoute({
    input: z
      .object({
        viewId: z.uuid(),
        cursor: z.string().max(256).nullable(),
        expectedIndexRevision: revision.nullable(),
        limit: z.number().int().min(1).max(32)
      })
      .strict(),
    output: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('stale') }),
      z.object({
        kind: z.literal('blocks'),
        indexRevision: revision,
        blocks: z.array(block).max(32),
        cursor: z.string().nullable()
      })
    ])
  }),
  'terminal.blocks.read': defineRoute({
    input: terminalBlockReadInput.extend({ viewId: z.uuid() }).strict(),
    output: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('stale') }),
      z.object({ kind: z.literal('unavailable') }),
      z.object({
        kind: z.literal('content'),
        block,
        text: z.string(),
        partial: z.array(z.enum(['history', 'size', 'metadata'])),
        mapping: z.array(z.object({ start: revision, end: revision, from: point, to: point }))
      })
    ])
  }),
  'terminal.search.set': defineRoute({
    input: terminalSearchInput.extend({ viewId: z.uuid() }).strict(),
    output: terminalSearchProjection
  }),
  'terminal.search.navigate': defineRoute({
    input: z
      .object({
        viewId: z.uuid(),
        queryRevision: revision,
        resultRevision: revision,
        direction: z.enum(['next', 'previous'])
      })
      .strict(),
    output: terminalSearchProjection.nullable()
  }),
  'terminal.search.close': defineRoute({
    input: z.object({ viewId: z.uuid(), queryRevision: revision }).strict(),
    output: z.void()
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
