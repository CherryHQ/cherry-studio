import { imageParamsSchema } from '@cherrystudio/provider-registry'
import type {
  AiStreamAttachResponse,
  AiStreamOpenResponse,
  AiToolApprovalRespondRequest,
  AiToolResultRequest,
  AiToolResultResponse,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
import {
  AgentBaseSchema,
  AgentEntitySchema,
  AgentSkillIdSetSchema,
  ScheduledTaskEntitySchema,
  TimeoutMinutesAtomSchema
} from '@shared/data/api/schemas/agents'
import { AgentSessionWorkspaceSourceSchema } from '@shared/data/api/schemas/agentWorkspaces'
import { JobScheduleNameAtomSchema, TriggerSchema } from '@shared/data/api/schemas/jobs'
import { type FileEntry, FileEntrySchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { ImageGenerationModeSchema, ModelSchema, UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'
import type { EmbeddingModelUsage, LanguageModelUsage, ModelMessage } from 'ai'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * AI IPC schemas — `AiService`'s non-streaming model operations (text/embedding/image
 * generation, model probe, model listing) plus the `AiStreamManager` streaming-chat
 * link (open/attach/detach/abort requests + chunk/done/error events). Each route
 * delegates to a stateful service method in main.
 *
 * Routes are namespaced `ai.<subdomain>[.<resource>].<verb>` — the subtree groups by
 * domain, not by owning service: `text` / `embedding` / `image` (one-shot calls by
 * output modality), `provider.model` (catalog + probe), `stream` (chat link and its
 * events), `tool` (deferred results, approvals), `agent.session` / `agent.task`,
 * and `topic` (auto-naming events).
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

export const CreateAgentCommandSchema = AgentBaseSchema.extend({
  type: z.literal('claude-code'),
  /**
   * Create-only: ids of pre-existing global skills to enable for the new
   * Agent. Join rows are written in the same DB transaction as the Agent.
   */
  skillIds: AgentSkillIdSetSchema.optional()
})
export type CreateAgentCommand = z.infer<typeof CreateAgentCommandSchema>

/**
 * Agent scheduled-task command DTOs. The task *command* surface lives here on
 * IpcApi (`ai.agent.task.*` → AgentJobsService); the read surface stays on
 * DataApi (`GET /agents/:agentId/tasks…`). Entity/read-model schemas remain in
 * `@shared/data/api/schemas/agents` — only the command inputs are owned here.
 */
const agentTaskFormSchema = z.strictObject({
  name: JobScheduleNameAtomSchema,
  prompt: z.string().min(1),
  trigger: TriggerSchema,
  workspace: AgentSessionWorkspaceSourceSchema,
  timeoutMinutes: TimeoutMinutesAtomSchema,
  channelIds: z.array(z.string()).optional()
})
export type AgentTaskForm = z.infer<typeof agentTaskFormSchema>

/** Edit-save patch: form fields only — pause/resume are separate commands, so no `enabled` here. */
const agentTaskPatchSchema = agentTaskFormSchema.partial()
export type AgentTaskPatch = z.infer<typeof agentTaskPatchSchema>

/** Task identity carried by every by-id command; `agentId` doubles as the ownership guard input. */
const agentTaskRefSchema = z.strictObject({
  agentId: z.string().min(1),
  taskId: z.string().min(1)
})

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
  // ── One-shot model calls, grouped by output modality (AiService) ──
  'ai.text.generate': defineRoute({
    input: z.strictObject({
      ...aiBaseRequestShape,
      system: z.string().optional(),
      prompt: z.string().optional(),
      messages: z.array(z.custom<ModelMessage>()).optional()
    }),
    output: z.object({ text: z.string(), usage: z.custom<LanguageModelUsage>().optional() })
  }),
  'ai.embedding.embed_many': defineRoute({
    input: z.strictObject({ ...aiBaseRequestShape, values: z.array(z.string()) }),
    output: z.object({ embeddings: z.array(z.array(z.number())), usage: z.custom<EmbeddingModelUsage>().optional() })
  }),
  'ai.image.generate': defineRoute({
    // requestId pairs the request with `ai.image.abort` (the abort registry lives in AiService).
    input: z.strictObject({ requestId: z.string().min(1), payload: aiImagePayloadSchema }),
    // Pin the output to the named `FileEntry` so declaration-emit references the alias
    // instead of trying to name FileEntry's module-private phantom path brand (TS4023).
    output: z.object({ files: z.array(FileEntrySchema) }) as z.ZodType<{ files: FileEntry[] }>
  }),
  'ai.image.abort': defineRoute({
    // Was a one-way `ipcOn`; per the migration guide a one-off becomes a `void` request.
    input: z.strictObject({ requestId: z.string().min(1) }),
    output: z.void()
  }),

  // ── Provider model catalog & reachability probe (AiService) ──
  'ai.provider.model.list': defineRoute({
    input: z.strictObject({
      providerId: z.string().optional(),
      assistantId: z.string().optional(),
      throwOnError: z.boolean().optional()
    }),
    output: z.array(ModelSchema.partial())
  }),
  'ai.provider.model.check': defineRoute({
    input: z.strictObject({
      ...aiBaseRequestShape,
      apiKeyOverride: z.string().optional(),
      timeout: z.number().optional()
    }),
    output: z.object({ latency: z.number() })
  }),

  // ── Streaming chat (AiStreamManager) ──
  // Requests are R→M; the produced chunk/done/error events ride the AiEventSchemas block below.
  'ai.stream.open': defineRoute({
    // Discriminated by `trigger`, mirroring AiStreamOpenRequest. `userMessageParts` is opaque
    // pass-through (main persists it), so its items are `z.custom<CherryMessagePart>()`.
    input: z.intersection(
      z.object({
        topicId: z.string().min(1),
        mentionedModelIds: z.array(UniqueModelIdSchema).optional()
      }),
      z.discriminatedUnion('trigger', [
        z.object({
          trigger: z.literal('submit-message'),
          parentAnchorId: z.string().optional(),
          userMessageParts: z.array(z.custom<CherryMessagePart>()),
          reasoningEffort: ReasoningEffortOptionSchema.optional(),
          fastMode: z.boolean().optional()
        }),
        z.object({
          trigger: z.literal('regenerate-message'),
          parentAnchorId: z.string().min(1),
          reasoningEffort: ReasoningEffortOptionSchema.optional(),
          fastMode: z.boolean().optional()
        })
      ])
    ),
    output: z.custom<AiStreamOpenResponse>()
  }),
  'ai.stream.attach': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.custom<AiStreamAttachResponse>()
  }),
  'ai.stream.detach': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.stream.abort': defineRoute({
    input: z.strictObject({ topicId: z.string().min(1) }),
    output: z.void()
  }),

  // ── Tool calls: deferred results + approval decisions. Spans two owners
  // (AiStreamManager holds the live output, AiService applies the decision) —
  // the subtree groups by domain, not by service.
  'ai.tool.get_result': defineRoute({
    // Mirrors AiToolResultRequest (z.ZodType pins exact-shape drift here, not in a test).
    input: z.strictObject({
      topicId: z.string().min(1),
      messageId: z.string().min(1),
      toolCallId: z.string().min(1)
    }) satisfies z.ZodType<AiToolResultRequest>,
    output: z.custom<AiToolResultResponse>()
  }),
  'ai.tool.respond_approval': defineRoute({
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

  // ── Agent session warm-connection lifecycle ──
  'ai.agent.create': defineRoute({
    input: CreateAgentCommandSchema,
    output: AgentEntitySchema
  }),
  'ai.agent.session.prewarm': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.void()
  }),
  'ai.agent.session.close_warm': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.void()
  }),

  // ── Agent scheduled-task commands (AgentJobsService is the sole command owner) ──
  // Mixed-effect mutations (schedule row + channel subscriptions + timer) belong on
  // IpcApi, not DataApi — the Job DataApi is GET-only (api-design-guidelines.md).
  'ai.agent.task.create': defineRoute({
    input: agentTaskFormSchema.extend({ agentId: z.string().min(1) }),
    // Commands return the authoritative committed read model so the caller
    // never has to re-read through DataApi to learn what was persisted.
    output: ScheduledTaskEntitySchema
  }),
  'ai.agent.task.update': defineRoute({
    input: agentTaskRefSchema.extend({ patch: agentTaskPatchSchema }),
    output: ScheduledTaskEntitySchema
  }),
  'ai.agent.task.pause': defineRoute({
    input: agentTaskRefSchema,
    output: ScheduledTaskEntitySchema
  }),
  'ai.agent.task.resume': defineRoute({
    input: agentTaskRefSchema,
    output: ScheduledTaskEntitySchema
  }),
  'ai.agent.task.delete': defineRoute({
    input: agentTaskRefSchema,
    output: z.void()
  }),
  'ai.agent.task.run': defineRoute({
    // No caller reads the trigger result, so the route is void (see ipc-migration-guide.md).
    input: agentTaskRefSchema,
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
  'ai.stream.chunk': StreamChunkPayload
  'ai.stream.done': StreamDonePayload
  'ai.stream.error': StreamErrorPayload
  // Auto-rename push (broadcast): a background job renamed a topic / agent session; any
  // window showing it should invalidate its cache.
  'ai.topic.auto_renamed': { topicId: string }
  'ai.agent.session.auto_renamed': { sessionId: string }
  // Auto-rename failure (broadcastToType Main): a background naming job's summarization call
  // failed (e.g. the naming model returned an auth error). Delivered to the main window only
  // — the job has no origin window — which surfaces it as a toast so the failure isn't silent.
  'ai.topic.naming_failed': { message: string }
}
