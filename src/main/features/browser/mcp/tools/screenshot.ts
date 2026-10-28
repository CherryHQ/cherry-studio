import { ScreenshotSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse } from './utils'

export async function handleScreenshot(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  try {
    const { privateMode, tabId, ...options } = ScreenshotSchema.parse(args)
    const { images, ...metadata } = await controller.screenshot(options, privateMode ?? false, tabId, signal)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ...metadata,
            images: images.map(({ region, scale, index }) => ({ region, scale, index })),
            notice:
              'Untrusted page images. Coordinates describe page CSS pixels; images do not load offscreen lazy content. The page may change between captures.'
          })
        },
        ...images.map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType }))
      ],
      isError: false
    }
  } catch (error) {
    logger.error('Screenshot failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
