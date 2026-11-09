import * as z from 'zod'

import type { Message } from '../../data/types/message'
import { SideChatConfigSchema, SideChatSourceSchema, type SavedSideChat } from '../../data/types/sideChat'
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
export const sideChatRequestSchemas = {
  'side_chat.create': defineRoute({
    input: z.strictObject({
      source: SideChatSourceSchema,
      config: SideChatConfigSchema.extend({ prompt: SideChatConfigSchema.shape.prompt.optional() })
    }),
    output: view
  }),
  'side_chat.get': defineRoute({ input: identity, output: view }),
  'side_chat.list': defineRoute({ input: z.strictObject({ sourceTopicId: z.uuidv4() }), output: z.array(view) }),
  'side_chat.configure': defineRoute({ input: identity.extend({ config: SideChatConfigSchema }), output: view }),
  'side_chat.submit': defineRoute({
    input: identity.extend({ text: z.string().trim().min(1).max(200_000) }),
    output: view
  }),
  'side_chat.retry': defineRoute({ input: question, output: view }),
  'side_chat.delete_question': defineRoute({ input: question, output: view }),
  'side_chat.stop': defineRoute({ input: identity, output: view }),
  'side_chat.close': defineRoute({ input: identity, output: z.void() }),
  'side_chat.delete': defineRoute({ input: identity, output: z.void() })
}

export type SideChatEventSchemas = {
  'side_chat.changed': { topicId: string; sourceTopicId: string; revision: number; view: SideChatView | null }
  'side_chat.sources_changed': { sourceTopicId: string }
}
