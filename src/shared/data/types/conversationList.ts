import * as z from 'zod'

export const ConversationListSortBySchema = z.enum(['lastActivityAt', 'createdAt', 'name', 'orderKey'])
export type ConversationListSortBy = z.infer<typeof ConversationListSortBySchema>

export const ConversationListSortSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('orderKey') }),
  z.object({
    by: z.enum(['lastActivityAt', 'createdAt', 'name']),
    direction: z.enum(['asc', 'desc'])
  })
])
export type ConversationListSort = z.infer<typeof ConversationListSortSchema>
