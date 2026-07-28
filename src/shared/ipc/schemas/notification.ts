import type { Notification } from '@shared/types/notification'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Notification IPC schemas.
 *
 * Request `notification.send`: shows an OS notification via the main NotificationService.
 * The payload is the full `Notification`, carried opaquely (`z.custom`) rather than zod-
 * mirrored — the renderer type-locks the shape (incl. the free-form `meta`) and main reads
 * only the fields it renders. It is fully serializable: callbacks are not carried across IPC;
 * an 'action' notification uses the string `actionKey` instead (see @shared/types/notification).
 *
 * Event `notification.clicked`: fires when the user clicks an OS notification; the main
 * NotificationService broadcasts the originating Notification back to the renderer. This is
 * the seam for future action-click dispatch (a renderer subscriber routing by `actionKey`).
 */
export const notificationRequestSchemas = {
  'notification.send': defineRoute({ input: z.custom<Notification>(), output: z.void() })
}

export type NotificationEventSchemas = {
  'notification.clicked': Notification
}
