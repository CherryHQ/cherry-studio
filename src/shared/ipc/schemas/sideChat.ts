import * as z from 'zod'

import type { CherryMessagePart, Message } from '../../data/types/message'
import { ServiceTierSelectionSchema } from '../../data/types/model'
import {
  SideChatConfigSchema,
  SideChatSourceSchema,
  SideChatSourceIdSchema,
  SideChatTurnSettingsSchema,
  type SavedSideChat
} from '../../data/types/sideChat'
import { ComposerMessageSnapshotSchema, KnowledgeScopePartDataSchema } from '../../data/types/uiParts'
import { ReasoningEffortOptionSchema } from '../../types/aiSdk'
import { defineRoute } from '../define'

export interface SideChatView extends SavedSideChat {
  revision: number
  mode: 'saved' | 'temporary'
  messages: Message[]
  generating: boolean
  omittedContext: Array<'answer' | 'source-question' | 'history'>
}

const identity = z.strictObject({ topicId: z.string().min(1) })
const question = identity.extend({ questionId: z.string().min(1) })
const view = z.custom<SideChatView>()
const userParts = z
  .array(
    z.custom<CherryMessagePart>((value) => {
      if (!value || typeof value !== 'object') return false
      const part = value as CherryMessagePart
      if (part.type === 'text') return typeof part.text === 'string'
      if (part.type === 'file') return typeof part.url === 'string' && typeof part.mediaType === 'string'
      return part.type === 'data-knowledge-scope' && KnowledgeScopePartDataSchema.safeParse(part.data).success
    })
  )
  .max(100)
// Home sends its current composer model on every submit/retry. Agent sources resolve their owner model in Main.
// Omission never reuses the stored side-chat model; it is only valid for Agent sources.
export const sideChatRequestSchemas = {
  'side_chat.create': defineRoute({
    input: z.strictObject({
      source: SideChatSourceSchema,
      config: SideChatConfigSchema.extend({ prompt: SideChatConfigSchema.shape.prompt.optional() })
    }),
    output: view
  }),
  'side_chat.get': defineRoute({ input: identity, output: view }),
  'side_chat.list': defineRoute({
    input: z.strictObject({ sourceTopicId: SideChatSourceIdSchema }),
    output: z.array(view)
  }),
  'side_chat.configure': defineRoute({ input: identity.extend({ config: SideChatConfigSchema }), output: view }),
  'side_chat.submit': defineRoute({
    input: identity
      .extend({
        text: z.string().max(200_000),
        parts: userParts.optional(),
        turnOptions: z
          .strictObject({
            reasoningEffort: ReasoningEffortOptionSchema.optional(),
            serviceTier: ServiceTierSelectionSchema.optional(),
            fastMode: z.boolean().optional(),
            sideChat: SideChatTurnSettingsSchema.optional()
          })
          .optional(),
        modelId: SideChatConfigSchema.shape.modelId.optional(),
        composer: ComposerMessageSnapshotSchema.optional()
      })
      .refine((input) => input.text.trim().length > 0 || input.parts?.some((part) => part.type === 'file'))
      .refine(
        (input) =>
          !input.parts ||
          input.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('') === input.text
      ),
    output: view
  }),
  'side_chat.retry': defineRoute({
    input: question.extend({ modelId: SideChatConfigSchema.shape.modelId.optional() }),
    output: view
  }),
  'side_chat.delete_question': defineRoute({ input: question, output: view }),
  'side_chat.respond_approval': defineRoute({
    input: identity.extend({
      messageId: z.string().min(1),
      approvalId: z.string().min(1),
      approved: z.boolean()
    }),
    output: view
  }),
  'side_chat.stop': defineRoute({ input: identity, output: view }),
  'side_chat.close': defineRoute({ input: identity, output: z.void() }),
  'side_chat.delete': defineRoute({ input: identity, output: z.void() })
}

export type SideChatEventSchemas = {
  'side_chat.changed': { topicId: string; sourceTopicId: string; revision: number; view: SideChatView | null }
  'side_chat.sources_changed': { sourceTopicId: string }
}
