import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, imageResponse } from './utils'

export const ScreenshotSchema = z.object({
  fullPage: z.boolean().optional().describe('Capture full scrollable page (default: false, viewport only)'),
  format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
  quality: z.number().min(0).max(100).optional().describe('JPEG quality 0-100 (only for jpeg format)'),
  privateMode: z.boolean().optional().describe('Target private session (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID')
})

export const screenshotToolDefinition = {
  name: 'screenshot',
  description:
    'Take a screenshot of the current page. Returns an image the model can see directly — much more efficient than fetching full page content for search results, dashboards, or verification. Prefer this over format=markdown for visually dense pages. PARALLEL: Can be called simultaneously with other tools.',
  inputSchema: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description: 'Capture full scrollable page (default: false, viewport only)'
      },
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Image format (default: png)'
      },
      quality: {
        type: 'number',
        description: 'JPEG quality 0-100 (only for jpeg format)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Target private session (default: false)'
      },
      tabId: {
        type: 'string',
        description: 'Target specific tab by ID (from open response)'
      }
    }
  }
}

export async function handleScreenshot(controller: CdpBrowserController, args: unknown) {
  try {
    const { fullPage, format, quality, privateMode, tabId } = ScreenshotSchema.parse(args)
    const base64 = await controller.screenshot({ fullPage, format, quality }, privateMode ?? false, tabId)
    const mimeType = (format ?? 'png') === 'jpeg' ? 'image/jpeg' : 'image/png'
    return imageResponse(base64, mimeType)
  } catch (error) {
    logger.error('Screenshot failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
