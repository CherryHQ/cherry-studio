import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const OpenSchema = z.object({
  url: z.url().describe('URL to navigate to'),
  format: z
    .enum(['html', 'txt', 'markdown', 'json'])
    .optional()
    .describe('If set, return page content in this format. If not set, just open the page and return tabId.'),
  timeout: z.number().optional().describe('Navigation timeout in ms (default: 10000)'),
  privateMode: z.boolean().optional().describe('Use incognito mode, no data persisted (default: false)'),
  newTab: z.boolean().optional().describe('Open in new tab, required for parallel requests (default: false)'),
  showWindow: z.boolean().optional().default(true).describe('Show browser window (default: true)')
})

export const openToolDefinition = {
  name: 'open',
  description:
    'Navigate to a URL in a browser window. If format is specified, returns { tabId, content } with page content in that format. Otherwise, returns { currentUrl, title, tabId } for subsequent operations with execute tool. Set newTab=true when opening multiple URLs in parallel.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to'
      },
      format: {
        type: 'string',
        enum: ['html', 'txt', 'markdown', 'json'],
        description: 'If set, return page content in this format. If not set, just open the page and return tabId.'
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in ms (default: 10000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Use incognito mode, no data persisted (default: false)'
      },
      newTab: {
        type: 'boolean',
        description: 'Open in new tab, required for parallel requests (default: false)'
      },
      showWindow: {
        type: 'boolean',
        description: 'Show browser window (default: true)'
      }
    },
    required: ['url']
  }
}

export async function handleOpen(controller: CdpBrowserController, args: unknown) {
  try {
    const { url, format, timeout, privateMode, newTab, showWindow } = OpenSchema.parse(args)

    if (format) {
      const { tabId, content } = await controller.fetch(
        url,
        format,
        timeout ?? 10000,
        privateMode ?? false,
        newTab ?? false,
        showWindow
      )
      return successResponse(JSON.stringify({ tabId, content }))
    } else {
      const res = await controller.open(url, timeout ?? 10000, privateMode ?? false, newTab ?? false, showWindow)
      return successResponse(JSON.stringify(res))
    }
  } catch (error) {
    logger.error('Open failed', {
      error,
      url: args && typeof args === 'object' && 'url' in args ? args.url : undefined
    })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
