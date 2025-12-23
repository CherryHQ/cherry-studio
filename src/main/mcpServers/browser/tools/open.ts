import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

export const OpenSchema = z.object({
  url: z.url().describe('URL to open in the controlled Electron window'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)'),
  privateMode: z
    .boolean()
    .optional()
    .describe('If true, use private browsing mode where data is not persisted (default: false)'),
  newTab: z
    .boolean()
    .optional()
    .describe(
      'If true, create a new tab for this request. Use this when opening multiple URLs in parallel (default: false)'
    )
})

export const openToolDefinition = {
  name: 'open',
  description: 'Open a URL in a browser window controlled via Chrome DevTools Protocol',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to load'
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in milliseconds (default 10000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'If true, use private browsing mode where data is not persisted (default: false)'
      },
      newTab: {
        type: 'boolean',
        description:
          'If true, create a new tab for this request. Use this when opening multiple URLs in parallel (default: false)'
      }
    },
    required: ['url']
  }
}

export async function handleOpen(controller: CdpBrowserController, args: unknown) {
  const { url, timeout, privateMode, newTab } = OpenSchema.parse(args)
  const res = await controller.open(url, timeout ?? 10000, privateMode ?? false, newTab ?? false)
  return successResponse(JSON.stringify(res))
}
