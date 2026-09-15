import * as z from 'zod'

import { screenshotOptionsSchema } from '../../actions/screenshot'
import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse } from './utils'

export const ScreenshotSchema = screenshotOptionsSchema.extend({
  privateMode: z.boolean().optional().describe('Target private session (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID')
})

export const screenshotToolDefinition = {
  name: 'screenshot',
  description:
    'Observe the current viewport, or crop a snapshot ref. Prefer snapshot to locate a target before taking its screenshot. fullPage returns up to four bounded image tiles without scrolling; use nextCursor to continue. Lazy content must be loaded explicitly. Images use page CSS coordinates from the accompanying metadata, not input coordinates.',
  inputSchema: ScreenshotSchema
}

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
