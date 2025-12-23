import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { errorResponse, successResponse } from './utils'

export const OpenSchema = z.object({
  url: z.url().describe('URL to navigate to'),
  timeout: z.number().optional().describe('Navigation timeout in ms (default: 10000)'),
  privateMode: z.boolean().optional().describe('Use incognito mode, no data persisted (default: false)'),
  newTab: z.boolean().optional().describe('Open in new tab, required for parallel requests (default: false)')
})

export const openToolDefinition = {
  name: 'open',
  description:
    'Navigate to a URL in a browser window. Use this to load a page for interaction. After opening, use execute to interact with the page or extract content. Returns tabId for subsequent operations.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to'
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
      }
    },
    required: ['url']
  }
}

export async function handleOpen(controller: CdpBrowserController, args: unknown) {
  try {
    const { url, timeout, privateMode, newTab } = OpenSchema.parse(args)
    const res = await controller.open(url, timeout ?? 10000, privateMode ?? false, newTab ?? false)
    return successResponse(JSON.stringify(res))
  } catch (error) {
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
