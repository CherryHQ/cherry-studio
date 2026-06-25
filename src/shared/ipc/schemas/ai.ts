import type { PersonGeneration } from '@google/genai'
import { type FileEntry, FileEntrySchema } from '@shared/data/types/file/fileEntry'
import { ModelSchema, type UniqueModelId } from '@shared/data/types/model'
import type { EmbeddingModelUsage, LanguageModelUsage, ModelMessage } from 'ai'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * AI IPC schemas — the non-streaming model operations served by `AiService`
 * (text/embedding/image generation, model probe, model listing). Each route
 * delegates to a stateful `AiService` method in main.
 *
 * Request-only domain: these ops push nothing main→renderer (the streaming chat
 * link — open/attach/chunk/done/error — is a separate domain, still on legacy IPC),
 * so there is no Event block.
 *
 * Inputs mirror the **wire shape** the renderer actually sends, i.e. the
 * clone-safe subset of the in-process request types: the in-process-only
 * `AbortSignal` and `callOverrides` (an AI SDK `ToolSet`, not structured-clone-safe)
 * are deliberately absent. Outputs reuse the canonical entity schemas
 * (`FileEntrySchema`, `ModelSchema`) where they exist and `z.custom<T>()` for opaque
 * AI SDK types (usage) — the router never parses `output`, and these are built by
 * trusted main, so a field mirror buys nothing (see ipc-migration-guide.md).
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
  uniqueModelId: z.custom<UniqueModelId>((v) => typeof v === 'string').optional(),
  mcpToolIds: z.array(z.string()).optional(),
  requestOptions: aiTransportOptionsSchema.optional()
}

const aiImagePayloadSchema = z.strictObject({
  ...aiBaseRequestShape,
  prompt: z.string(),
  inputImages: z.array(z.string()).optional(),
  mask: z.string().optional(),
  n: z.number().optional(),
  size: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  quality: z.string().optional(),
  numInferenceSteps: z.number().optional(),
  guidanceScale: z.number().optional(),
  promptEnhancement: z.boolean().optional(),
  personGeneration: z.custom<PersonGeneration>().optional(),
  aspectRatio: z.string().optional(),
  background: z.string().optional(),
  moderation: z.string().optional(),
  style: z.string().optional(),
  providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).optional()
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
    input: z.strictObject({ ...aiBaseRequestShape, timeout: z.number().optional() }),
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
  })
}
