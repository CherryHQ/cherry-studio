import * as z from 'zod'

import { UpdateKnowledgeBaseSchema } from '@shared/data/api/schemas/knowledges'
import {
  ExternalKnowledgeSchedulePolicySchema,
  ExternalKnowledgeSourceSchema
} from '@shared/data/types/externalKnowledge'
import { ExternalKnowledgeConnectionSchema } from '@shared/data/types/externalKnowledgeConnection'
import {
  ExternalKnowledgeScopePreviewSchema,
  ExternalKnowledgeScopeResolutionSchema
} from '@shared/data/types/externalKnowledgeRead'
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
import { AbsoluteFilePathSchema } from '@shared/types/file'

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
const sessionIdSchema = z.uuid()
const connectionIdSchema = z.uuidv7()
const feishuScopeInputSchema = z.strictObject({
  connectionId: connectionIdSchema,
  url: z.url().max(4096)
})
const feishuApplicationCredentialsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal-agent'), registrationSessionId: sessionIdSchema }),
  z.strictObject({
    kind: z.literal('custom-app'),
    appId: z.string().trim().min(1).max(256),
    appSecret: z.string().min(1).max(1024),
    applicationName: z.string().trim().min(1).max(256).optional()
  })
])
const beginAuthorizationOutputSchema = z.strictObject({
  authorizationSessionId: sessionIdSchema,
  connection: ExternalKnowledgeConnectionSchema,
  userCode: z.string().trim().min(1).max(256),
  verificationUri: z.url(),
  expiresAt: z.iso.datetime()
})
// delete_items and reindex_items share the same input shape.
const itemIdsInputSchema = z.strictObject({
  baseId: baseIdSchema,
  itemIds: z.array(z.string().trim().min(1)).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const knowledgeRequestSchemas = {
  'knowledge.external_source.create': defineRoute({
    input: z.strictObject({
      baseId: z.uuidv4(),
      connectionId: connectionIdSchema,
      url: z.url().max(4096),
      name: z.string().trim().min(1).max(256)
    }),
    output: ExternalKnowledgeSourceSchema
  }),
  'knowledge.external_source.sync': defineRoute({
    input: z.strictObject({ sourceId: z.uuidv7() }),
    output: ExternalKnowledgeSourceSchema
  }),
  'knowledge.external_source.schedule.update': defineRoute({
    input: z.strictObject({ sourceId: z.uuidv7(), policy: ExternalKnowledgeSchedulePolicySchema }),
    output: ExternalKnowledgeSourceSchema
  }),
  'knowledge.external_source.disconnect': defineRoute({
    input: z.strictObject({ sourceId: z.uuidv7(), mode: z.enum(['keep-local', 'remove-local']) }),
    output: z.void()
  }),
  'knowledge.feishu.registration.begin': defineRoute({
    input: z.void(),
    output: z.strictObject({
      registrationSessionId: sessionIdSchema,
      verificationUri: z.url(),
      expiresAt: z.iso.datetime()
    })
  }),
  'knowledge.feishu.registration.cancel': defineRoute({
    input: z.strictObject({ registrationSessionId: sessionIdSchema }),
    output: z.void()
  }),
  'knowledge.feishu.authorization.begin': defineRoute({
    input: feishuApplicationCredentialsSchema,
    output: beginAuthorizationOutputSchema
  }),
  'knowledge.feishu.authorization.complete': defineRoute({
    input: z.strictObject({ authorizationSessionId: sessionIdSchema }),
    output: ExternalKnowledgeConnectionSchema
  }),
  'knowledge.feishu.authorization.cancel': defineRoute({
    input: z.strictObject({ authorizationSessionId: sessionIdSchema }),
    output: z.void()
  }),
  'knowledge.feishu.connection.reconnect': defineRoute({
    input: z.strictObject({
      connectionId: connectionIdSchema,
      credentials: feishuApplicationCredentialsSchema.optional()
    }),
    output: beginAuthorizationOutputSchema
  }),
  'knowledge.feishu.connection.validate': defineRoute({
    input: z.strictObject({ connectionId: connectionIdSchema }),
    output: ExternalKnowledgeConnectionSchema
  }),
  'knowledge.feishu.connection.remove': defineRoute({
    input: z.strictObject({ connectionId: connectionIdSchema }),
    output: z.void()
  }),
  'knowledge.feishu.scope.resolve': defineRoute({
    input: feishuScopeInputSchema,
    output: ExternalKnowledgeScopeResolutionSchema
  }),
  'knowledge.feishu.scope.preview': defineRoute({
    input: feishuScopeInputSchema,
    output: ExternalKnowledgeScopePreviewSchema
  }),
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
    output: AbsoluteFilePathSchema
  }),
  'knowledge.list_item_chunks': defineRoute({
    input: z.strictObject({ baseId: baseIdSchema, itemId: z.string().trim().min(1) }),
    output: z.array(KnowledgeItemChunkSchema)
  })
}
