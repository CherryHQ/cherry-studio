import * as z from 'zod'

const filterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), target: z.string() }),
  z.object({
    kind: z.literal('tree'),
    root: z.string(),
    includeHidden: z.boolean(),
    gitignoreRules: z.array(z.string()).readonly().optional(),
    missingRoot: z.boolean()
  })
])

export const watcherInputSchema = z.object({
  root: z.string(),
  options: z.object({
    recursive: z.boolean().optional(),
    followSymlinks: z.boolean().optional(),
    maxDepth: z.number().int().nonnegative().optional(),
    filter: filterSchema.optional(),
    stabilityThresholdMs: z.number().nonnegative().optional(),
    emitInitial: z.boolean().optional()
  })
})

export type WatcherInput = z.infer<typeof watcherInputSchema>
export type WatcherOptions = WatcherInput['options']

export const watcherMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['add', 'addDir', 'unlink', 'unlinkDir', 'change']), path: z.string() }),
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
  z.object({ kind: z.literal('warning'), message: z.string(), error: z.string() }),
  z.object({ kind: z.literal('closed') })
])

export type WatcherMessage = z.infer<typeof watcherMessageSchema>

export const watcherCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), id: z.number().int(), input: watcherInputSchema }),
  z.object({ kind: z.literal('close'), id: z.number().int() }),
  z.object({ kind: z.literal('stop') })
])
export type WatcherCommand = z.infer<typeof watcherCommandSchema>
export const watcherReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), id: z.number().int(), event: watcherMessageSchema }),
  z.object({ kind: z.literal('stopped') })
])
export type WatcherReply = z.infer<typeof watcherReplySchema>
