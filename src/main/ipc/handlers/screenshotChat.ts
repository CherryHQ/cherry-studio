import { application } from '@application'
import type { screenshotChatRequestSchemas } from '@shared/ipc/schemas/screenshotChat'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const screenshotChatHandlers: IpcHandlersFor<typeof screenshotChatRequestSchemas> = {
  'chat.screenshot.capture': async (_input, ctx) => {
    if (ctx.senderId) await application.get('ScreenshotChatService').startCapture(ctx.senderId)
  },
  'chat.screenshot.target': async ({ scopeKey }, ctx) => {
    if (ctx.senderId) application.get('ScreenshotChatService').setTarget(ctx.senderId, scopeKey)
  },
  'chat.screenshot.received': async ({ deliveryId, accepted }, ctx) => {
    if (ctx.senderId) application.get('ScreenshotChatService').receiveResult(ctx.senderId, deliveryId, accepted)
  }
}
