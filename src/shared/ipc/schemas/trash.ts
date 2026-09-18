import * as z from 'zod'

import type { DeleteAssistantResult } from '@shared/data/api/schemas/assistants'
import { TerminalJobStatusSchema } from '@shared/data/api/schemas/jobs'
import type { DeleteTopicsResult } from '@shared/data/api/schemas/topics'

import { defineRoute } from '../define'

/** Trash lifecycle commands that coordinate runtime state with persisted data. */
export const trashRequestSchemas = {
  'trash.assistant.delete_permanently': defineRoute({
    input: z.strictObject({ assistantId: z.string().min(1), deleteTopics: z.boolean() }),
    output: z.strictObject({
      deleted: z.boolean(),
      deletedTopicIds: z.array(z.string()).optional()
    }) satisfies z.ZodType<DeleteAssistantResult>
  }),
  'trash.topic.delete_permanently': defineRoute({
    input: z.strictObject({ topicIds: z.array(z.string().min(1)).min(1) }),
    output: z.strictObject({
      deletedIds: z.array(z.string()),
      deletedCount: z.number().int().nonnegative()
    }) satisfies z.ZodType<DeleteTopicsResult>
  }),
  'trash.topic.archive': defineRoute({
    input: z.strictObject({ topicIds: z.array(z.string().min(1)).min(1) }),
    output: z.strictObject({
      deletedIds: z.array(z.string()),
      deletedCount: z.number().int().nonnegative()
    }) satisfies z.ZodType<DeleteTopicsResult>
  }),
  'trash.assistant_topics.archive': defineRoute({
    input: z.strictObject({ assistantId: z.string().min(1) }),
    output: z.strictObject({
      deletedIds: z.array(z.string()),
      deletedCount: z.number().int().nonnegative()
    }) satisfies z.ZodType<DeleteTopicsResult>
  }),
  'trash.assistant.archive': defineRoute({
    input: z.strictObject({ assistantId: z.string().min(1), deleteTopics: z.boolean() }),
    output: z.strictObject({
      deleted: z.boolean(),
      deletedTopicIds: z.array(z.string()).optional()
    }) satisfies z.ZodType<DeleteAssistantResult>
  }),
  'trash.purge_now': defineRoute({
    input: z.void(),
    output: z.strictObject({
      status: TerminalJobStatusSchema,
      reclaimed: z.boolean(),
      deletedCount: z.number().int().nonnegative(),
      retainedReferencedFileCount: z.number().int().nonnegative()
    })
  })
}
