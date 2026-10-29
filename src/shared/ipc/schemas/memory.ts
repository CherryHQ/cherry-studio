import * as z from 'zod'

import { MemoryDreamingStatusSchema, MemoryScopeSchema } from '@shared/types/memory'

import { defineRoute } from '../define'

const editor = z.object({ editorId: z.uuid() })
const receipt = editor.extend({ receipt: z.uuid() })
const token = editor.extend({ token: z.uuid() })
const file = z.object({ path: z.string(), hash: z.string().nullable() })
const result = z.object({
  batchId: z.string().nullable(),
  files: z.array(file.extend({ outcome: z.enum(['applied', 'unchanged', 'conflict', 'pending']) })),
  error: z.string().optional()
})

export const memoryRequestSchemas = {
  'memory.dreaming.status': defineRoute({ input: MemoryScopeSchema, output: MemoryDreamingStatusSchema }),
  'memory.dreaming.request': defineRoute({ input: MemoryScopeSchema, output: z.void() }),
  'memory.dreaming.cancel': defineRoute({ input: MemoryScopeSchema, output: z.void() }),
  'memory.editor.open': defineRoute({
    input: MemoryScopeSchema,
    output: z.object({
      editorId: z.uuid(),
      maxBytes: z.number(),
      maxLines: z.number(),
      warningBytes: z.number(),
      warningLines: z.number()
    })
  }),
  'memory.editor.close': defineRoute({ input: editor, output: z.void() }),
  'memory.file.list': defineRoute({ input: editor, output: z.array(z.string()) }),
  'memory.file.read': defineRoute({
    input: editor.extend({ path: z.string().min(1).max(512) }),
    output: file.extend({ content: z.string().nullable(), receipt: z.uuid() })
  }),
  'memory.file.write': defineRoute({ input: receipt.extend({ content: z.string().max(25000) }), output: result }),
  'memory.file.delete': defineRoute({ input: receipt, output: result }),
  'memory.file.rename': defineRoute({ input: receipt.extend({ destinationReceipt: z.uuid() }), output: result }),
  'memory.clear.preview': defineRoute({ input: editor, output: z.object({ token: z.uuid(), files: z.array(file) }) }),
  'memory.clear.confirm': defineRoute({ input: token, output: result }),
  'memory.recovery.preview': defineRoute({
    input: editor,
    output: z
      .object({
        token: z.uuid(),
        batchId: z.string(),
        files: z.array(z.object({ path: z.string(), currentHash: z.string().nullable(), conflict: z.boolean() }))
      })
      .optional()
  }),
  'memory.recovery.confirm': defineRoute({ input: token, output: result })
}
