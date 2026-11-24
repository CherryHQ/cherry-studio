import * as z from 'zod'

export const ConversationListSortBySchema = z.enum(['lastActivityAt', 'createdAt', 'name', 'orderKey'])
export type ConversationListSortBy = z.infer<typeof ConversationListSortBySchema>

export const ConversationListSortLocaleSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((locale) => {
    try {
      return Intl.getCanonicalLocales(locale).length === 1
    } catch {
      return false
    }
  }, 'Invalid locale')

export const ConversationListSortSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('orderKey') }),
  z.object({
    by: z.enum(['lastActivityAt', 'createdAt', 'name']),
    direction: z.enum(['asc', 'desc'])
  })
])
export type ConversationListSort = z.infer<typeof ConversationListSortSchema>
