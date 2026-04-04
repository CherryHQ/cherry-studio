import * as z from 'zod'

/**
 * Zod schema for AI stream request validation.
 *
 * Mirrors `AiStreamRequest` interface in `src/main/ai/AiCompletionService.ts`.
 * Used for runtime validation at IPC boundaries.
 */
export const aiStreamRequestSchema = z.object({
  requestId: z.string(),
  chatId: z.string(),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  messageId: z.string().optional(),
  messages: z.array(z.unknown()), // UIMessage[] — no deep validation at runtime
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  assistantConfig: z.record(z.string(), z.unknown()).optional(),
  websearchConfig: z.record(z.string(), z.unknown()).optional(),
  mcpToolIds: z.array(z.string()).optional(),
  knowledgeBaseIds: z.array(z.string()).optional()
})

export type AiStreamRequestSchema = z.infer<typeof aiStreamRequestSchema>
