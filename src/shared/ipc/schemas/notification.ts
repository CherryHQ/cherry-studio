import * as z from 'zod'

import type { ConversationNotification, Notification } from '@shared/types/notification'

import { defineRoute } from '../define'
import { conversationNavigationTargetSchema } from './navigation'

/**
 * Notification IPC schemas.
 *
 * Request `notification.send`: shows an OS notification via the main NotificationService.
 * The payload is the full `Notification`, carried opaquely (`z.custom`) rather than zod-
 * mirrored — the renderer type-locks the shape (incl. the free-form `meta`) and main reads
 * only the fields it renders. It is fully serializable: callbacks are not carried across IPC;
 * an 'action' notification uses the string `actionKey` instead (see @shared/types/notification).
 *
 * Request `notification.mark_conversation_viewed`: the renderer reports that the user is looking at a
 * conversation, clearing it from the unread set behind the Windows taskbar badge.
 *
 * Event `notification.clicked`: fires when the user clicks an OS notification that is not handled
 * directly by the main process. NotificationService broadcasts the originating Notification back
 * to the renderer as the existing action-click dispatch seam.
 *
 * Event `notification.conversation`: carries a presentation-ready task-completion or approval-request
 * notification to one foreground full-chrome renderer. Background system notifications stay
 * main-owned.
 */
export const notificationRequestSchemas = {
  'notification.send': defineRoute({ input: z.custom<Notification>(), output: z.void() }),
  'notification.mark_conversation_viewed': defineRoute({
    input: conversationNavigationTargetSchema,
    output: z.void()
  })
}

export type NotificationEventSchemas = {
  'notification.clicked': Notification
  'notification.conversation': ConversationNotification
}
