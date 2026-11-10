import * as z from 'zod'

import { defineRoute } from '../define'

export const screenshotChatRequestSchemas = {
  'chat.screenshot.capture': defineRoute({ input: z.void(), output: z.void() }),
  'chat.screenshot.target': defineRoute({ input: z.object({ scopeKey: z.string().nullable() }), output: z.void() }),
  'chat.screenshot.received': defineRoute({
    input: z.object({ deliveryId: z.string(), accepted: z.boolean() }),
    output: z.void()
  })
}

export type ScreenshotChatEventSchemas = {
  'chat.screenshot.attachment': {
    deliveryId: string
    imageUrl: string
    name: string
    size: number
    text: string
    scopeKey: string
  }
}
