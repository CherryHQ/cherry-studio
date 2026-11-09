import * as z from 'zod'

import {
  SideChatConfigSchema,
  SideChatSourceSchema,
  type SavedSideChat,
  type SideChatConfig
} from '../../types/sideChat'

export const CreateSavedSideChatSchema = z.strictObject({ source: SideChatSourceSchema, config: SideChatConfigSchema })

/** Saved-data primitives. Temporary sessions must never call these write endpoints. */
export type SideChatSchemas = {
  '/side-chats': {
    POST: { body: z.infer<typeof CreateSavedSideChatSchema>; response: SavedSideChat }
  }
  '/topics/:sourceTopicId/side-chats': {
    GET: { params: { sourceTopicId: string }; response: SavedSideChat[] }
  }
  '/side-chats/:topicId': {
    GET: { params: { topicId: string }; response: SavedSideChat }
    PATCH: { params: { topicId: string }; body: SideChatConfig; response: void }
  }
}
