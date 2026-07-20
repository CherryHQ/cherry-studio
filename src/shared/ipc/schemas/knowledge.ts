import { UpdateKnowledgeBaseSchema } from '@shared/data/api/schemas/knowledges'
import { AbsolutePathSchema } from '@shared/data/types/file'
import {
  CreateKnowledgeBaseSchema,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  KnowledgeAddConflictStrategySchema,
  KnowledgeAddItemInputSchema,
  KnowledgeAddItemsResultSchema,
  KnowledgeBaseSchema,
  KnowledgeItemChunkSchema,
  KnowledgeSearchResultSchema,
  RestoreKnowledgeBaseResultSchema,
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
  'knowledge.restore_base': defineRoute({
    input: RestoreKnowledgeBaseSchema,
    output: RestoreKnowledgeBaseResultSchema
  }),
  'knowledge.delete_base': defineRoute({ input: z.strictObject({ baseId: baseIdSchema }), output: z.void() }),
  'knowledge.add_items': defineRoute({
    input: z.strictObject({
      baseId: baseIdSchema,
      // Hard backstop shared with the runtime cap (delete/reindex reuse it). The interactive
      // add dialog enforces a stricter per-batch limit before calling and surfaces a friendly
      // hint; this bound only stops an oversized batch from reaching the workflow service.
      items: z.array(KnowledgeAddItemInputSchema).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX),
      // Omitted by internal callers (defaults to 'rename'); an interactive add sends
      // 'detect' first, then 'rename'/'replace' once the user resolves a conflict.
      conflictStrategy: KnowledgeAddConflictStrategySchema.optional()
    }),
    output: KnowledgeAddItemsResultSchema
  }),
  'knowledge.delete_items': defineRoute({ input: itemIdsInputSchema, output: z.void() }),
  'knowledge.reindex_items': defineRoute({ input: itemIdsInputSchema, output: z.void() }),
  // First-time embedding setup on a BM25-only base that already has items: sets the
  // model/dimensions in place and backfills embeddings, instead of restoring into a
  // new base. Switching an already-configured model still goes through restore_base.
  'knowledge.enable_embedding_model': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, patch: UpdateKnowledgeBaseSchema }),
    output: KnowledgeBaseSchema
  }),
  'knowledge.search': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, query: z.string().trim().min(1).max(1000) }),
    output: z.array(KnowledgeSearchResultSchema)
  }),
  // Resolve only the knowledge-managed raw copy or captured URL snapshot. `itemId` is the ownership
  // authority; accepting a separate baseId would make mismatched item/base pairs representable.
  'knowledge.get_file_path': defineRoute({
    input: z.strictObject({ itemId: z.string().trim().min(1) }),
    output: AbsolutePathSchema
  }),
  'knowledge.list_item_chunks': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, itemId: z.string().trim().min(1) }),
    output: z.array(KnowledgeItemChunkSchema)
  })
}
