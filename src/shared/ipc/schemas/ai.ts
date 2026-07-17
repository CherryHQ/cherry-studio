import { imageParamsSchema } from '@cherrystudio/provider-registry'
import type {
  AiStreamAttachResponse,
  AiStreamOpenResponse,
  AiToolApprovalRespondRequest,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
import { type FileEntry, FileEntrySchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { ImageGenerationModeSchema, ModelSchema, UniqueModelIdSchema } from '@shared/data/types/model'
import type { EmbeddingModelUsage, LanguageModelUsage, ModelMessage } from 'ai'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * AI IPC schemas — `AiService`'s non-streaming model operations (text/embedding/image
 * generation, model probe, model listing) plus the `AiStreamManager` streaming-chat
 * link (open/attach/detach/abort requests + chunk/done/error events). Each route
 * delegates to a stateful service method in main.
 *
 * Inputs mirror the **wire shape** the renderer actually sends, i.e. the
 * clone-safe subset of the in-process request types: the in-process-only
 * `AbortSignal` and `callOverrides` (an AI SDK `ToolSet`, not structured-clone-safe)
 * are deliberately absent. Outputs reuse the canonical entity schemas
 * (`FileEntrySchema`, `ModelSchema`) where they exist and `z.custom<T>()` for opaque
 * AI SDK / transport types (usage, stream responses) — the router never parses
 * `output`, and these are built by trusted main, so a field mirror buys nothing
 * (see ipc-migration-guide.md).
 */

/** Clone-safe subset of `AiTransportOptions` (no signal). */
const aiTransportOptionsSchema = z.object({
  headers: z.record(z.string(), z.string().optional()).optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional()
})

/** Clone-safe subset of `AiBaseRequest` shared by text / embed / image routes. */
const aiBaseRequestShape = {
  assistantId: z.string().optional(),
  // Strict `providerId::modelId` validation (separator at a real position, both
  // parts well-formed) — a malformed id is rejected here instead of throwing later
  // in `parseUniqueModelId`. The brand `z.custom<UniqueModelId>` alone only checked
  // string-ness, letting a bad id penetrate to the routing code.
  uniqueModelId: UniqueModelIdSchema.optional(),
  mcpToolIds: z.array(z.string()).optional(),
  requestOptions: aiTransportOptionsSchema.optional()
}

const aiImagePayloadSchema = z.strictObject({
  ...aiBaseRequestShape,
  prompt: z.string(),
  /**
   * The image-generation mode (which tab). A request property — NOT a param — so
   * main can derive per-model transport routing (`vendorTransport` → descriptor)
   * from the registry itself. Defaults to `generate` when absent.
   */
  mode: ImageGenerationModeSchema.optional(),
  /**
   * The canonical param bag, validated + coerced at the IPC boundary by the
   * catalog value schema — the router's `safeParse` yields a typed `ParamValues`
   * (non-catalog keys stripped). Per-model option/range constraints already ran
   * in the renderer's `buildParamsSchema`; this is the value-type gate.
   */
  paramValues: imageParamsSchema,
  /** Attached images / mask are encoded file bytes (data URLs), not form params. */
  inputImages: z.array(z.string()).optional(),
  mask: z.string().optional()
})

export const aiRequestSchemas = {
  'ai.generate_text': defineRoute({
    input: z.strictObject({
      ...aiBaseRequestShape,
      system: z.string().optional(),
      prompt: z.string().optional(),
      messages: z.array(z.custom<ModelMessage>()).optional()
    }),
    output: z.object({ text: z.string(), usage: z.custom<LanguageModelUsage>().optional() })
  }),
  'ai.check_model': defineRoute({
    input: z.strictObject({
      ...aiBaseRequestShape,
      apiKeyOverride: z.string().optional(),
      timeout: z.number().optional()
    }),
    output: z.object({ latency: z.number() })
  }),
  'ai.embed_many': defineRoute({
    input: z.strictObject({ ...aiBaseRequestShape, values: z.array(z.string()) }),
    output: z.object({ embeddings: z.array(z.array(z.number())), usage: z.custom<EmbeddingModelUsage>().optional() })
  }),
  'ai.generate_image': defineRoute({
    // requestId pairs the request with `ai.abort_image` (the abort registry lives in AiService).
    input: z.strictObject({ requestId: z.string().min(1), payload: aiImagePayloadSchema }),
    // Pin the output to the named `FileEntry` so declaration-emit references the alias
    // instead of trying to name FileEntry's module-private phantom path brand (TS4023).
    output: z.object({ files: z.array(FileEntrySchema) }) as z.ZodType<{ files: FileEntry[] }>
  }),
  'ai.abort_image': defineRoute({
    // Was a one-way `ipcOn`; per the migration guide a one-off becomes a `void` request.
    input: z.strictObject({ requestId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.list_models': defineRoute({
    input: z.strictObject({
      providerId: z.string().optional(),
      assistantId: z.string().optional(),
      throwOnError: z.boolean().optional()
    }),
    output: z.array(ModelSchema.partial())
  }),

  // ── Streaming chat (AiStreamManager) ──
  // Requests are R→M; the produced chunk/done/error events ride the AiEventSchemas block below.
  'ai.stream_open': defineRoute({
    // Discriminated by `trigger`, mirroring AiStreamOpenRequest. `userMessageParts` is opaque
    // pass-through (main persists it), so its items are `z.custom<CherryMessagePart>()`.
    input: z.intersection(
      z.object({
        topicId: z.string().min(1),
        mentionedModelIds: z.array(UniqueModelIdSchema).optional(),
        knowledgeBaseIds: z.array(z.string()).optional()
      }),
      z.discriminatedUnion('trigger', [
        z.object({
          trigger: z.literal('submit-message'),
          parentAnchorId: z.string().optional(),
          userMessageParts: z.array(z.custom<CherryMessagePart>())
        }),
        z.object({
          trigger: z.literal('regenerate-message'),
          parentAnchorId: z.string().min(1)
        })
      ])
    ),
    output: z.custom<AiStreamOpenResponse>()
  }),
  'ai.stream_attach': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.custom<AiStreamAttachResponse>()
  }),
  'ai.stream_detach': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.stream_abort': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.void()
  }),

  // ── Agent sessions & tasks ──
  'ai.prewarm_agent_session': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.close_agent_session_warm': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.respond_tool_approval': defineRoute({
    // Mirrors AiToolApprovalRespondRequest (z.ZodType pins exact-shape drift here, not in a test).
    // strictObject for parity with the model-op routes — reject unknown keys rather than strip them.
    input: z.strictObject({
      approvalId: z.string().min(1),
      approved: z.boolean(),
      reason: z.string().optional(),
      updatedInput: z.record(z.string(), z.unknown()).optional(),
      topicId: z.string().optional(),
      anchorId: z.string().optional()
    }) satisfies z.ZodType<AiToolApprovalRespondRequest>,
    output: z.object({ ok: z.boolean() })
  }),
  'ai.run_agent_task': defineRoute({
    // No caller reads the trigger result, so the route is void (see ipc-migration-guide.md).
    input: z.string().min(1),
    output: z.void()
  })
}

/**
 * AI events (M→R, pure types — main is the TCB that builds them). High-frequency topic
 * streams: `AiStreamManager`'s per-(topic,window) `WebContentsListener` emits these via
 * directed `webContents.send` on the IpcApi event channel (class-B topic stream), keeping
 * its coalescing/liveness intact — it does not `broadcast`.
 */
export type AiEventSchemas = {
  'ai.stream_chunk': StreamChunkPayload
  'ai.stream_done': StreamDonePayload
  'ai.stream_error': StreamErrorPayload
  // Auto-rename push (broadcast): a background job renamed a topic / agent session; any
  // window showing it should invalidate its cache.
  'ai.topic_auto_renamed': { topicId: string }
  'ai.agent_session_auto_renamed': { sessionId: string }
  // Auto-rename failure (broadcastToType Main): a background naming job's summarization call
  // failed (e.g. the naming model returned an auth error). Delivered to the main window only
  // — the job has no origin window — which surfaces it as a toast so the failure isn't silent.
  'ai.topic_naming_failed': { message: string }
}
