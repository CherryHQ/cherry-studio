import * as z from 'zod'

export const NotificationCategorySchema = z.enum(['system', 'usage', 'official'])
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>

export const AnnouncementUrlSchema = z
  .string()
  .regex(/^https:\/\/github\.com\/CherryHQ\/cherry-studio\/discussions\/[1-9]\d*\/?$/i)

export const NotificationTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('conversation'),
    conversationType: z.enum(['assistant', 'agent']),
    conversationId: z.string().min(1)
  }),
  z.object({ kind: z.literal('settings'), tab: z.enum(['usage', 'data']) }),
  z.object({ kind: z.literal('knowledge'), baseId: z.string().min(1) }),
  z.object({ kind: z.literal('release'), version: z.string().min(1), releaseNotes: z.string() }),
  z.object({ kind: z.literal('announcement'), url: AnnouncementUrlSchema, content: z.string().min(1) })
])
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>

export const NotificationRecordSchema = z.object({
  id: z.uuid(),
  eventKey: z.string().min(1),
  category: NotificationCategorySchema,
  kind: z.string().min(1),
  title: z.string(),
  message: z.string(),
  createdAt: z.number().int().nonnegative(),
  readAt: z.number().nullable(),
  dismissedAt: z.number().nullable(),
  target: NotificationTargetSchema.nullable()
})
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>

export type CreateNotificationRecordInput = Pick<
  NotificationRecord,
  'eventKey' | 'category' | 'kind' | 'title' | 'message' | 'createdAt'
> & { target?: NotificationTarget | null }
