import {
  CreateKnowledgeBaseSchema,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  KnowledgeAddItemInputSchema,
  KnowledgeBaseSchema,
  KnowledgeItemChunkSchema,
  KnowledgeSearchResultSchema,
  RestoreKnowledgeBaseSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Knowledge IPC schemas — caller-facing runtime operations on knowledge bases and
 * their items, each delegating to the stateful KnowledgeService in main.
 *
 * Only a Request block: these are zod *values* (renderer→main, untrusted → always
 * parsed). The knowledge domain pushes nothing main→renderer — indexing progress
 * reaches the renderer through DataApi polling of item status, not IPC events — so
 * there is no Event block (unlike window.ts/selection.ts).
 *
 * Inputs reuse the canonical knowledge zod schemas from `@shared/data/types/knowledge`
 * so a DTO-shape drift is a compile error here. Outputs reuse the same entity schemas;
 * routes whose result no caller reads are `z.void()` (see ipc-migration-guide.md, the
 * "Return Values: void When Meaningless" rule).
 */

const baseIdSchema = z.string().trim().min(1)
// delete_items and reindex_items share the same input shape.
const itemIdsInputSchema = z.strictObject({
  baseId: baseIdSchema,
  itemIds: z.array(z.string().trim().min(1)).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const knowledgeRequestSchemas = {
  'knowledge.create_base': defineRoute({
    input: z.strictObject({ base: CreateKnowledgeBaseSchema }),
    output: KnowledgeBaseSchema
  }),
  'knowledge.restore_base': defineRoute({ input: RestoreKnowledgeBaseSchema, output: KnowledgeBaseSchema }),
  'knowledge.delete_base': defineRoute({ input: z.strictObject({ baseId: baseIdSchema }), output: z.void() }),
  'knowledge.add_items': defineRoute({
    input: z.strictObject({
      baseId: baseIdSchema,
      items: z.array(KnowledgeAddItemInputSchema).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
    }),
    output: z.void()
  }),
  'knowledge.delete_items': defineRoute({ input: itemIdsInputSchema, output: z.void() }),
  'knowledge.reindex_items': defineRoute({ input: itemIdsInputSchema, output: z.void() }),
  'knowledge.search': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, query: z.string().trim().min(1).max(1000) }),
    output: z.array(KnowledgeSearchResultSchema)
  }),
  'knowledge.list_item_chunks': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, itemId: z.string().trim().min(1) }),
    output: z.array(KnowledgeItemChunkSchema)
  })
}
