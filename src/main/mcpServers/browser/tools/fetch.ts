import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { errorResponse, successResponse } from './utils'

export const FetchSchema = z.object({
  url: z.url().describe('URL to fetch'),
  format: z.enum(['html', 'txt', 'markdown', 'json']).default('markdown').describe('Output format (default: markdown)'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)'),
  privateMode: z
    .boolean()
    .optional()
    .describe('If true, use private browsing mode where data is not persisted (default: false)'),
  newTab: z
    .boolean()
    .optional()
    .describe(
      'If true, create a new tab for this request. Use this when fetching multiple URLs in parallel (default: false)'
    )
})

export const fetchToolDefinition = {
  name: 'fetch',
  description:
    'Navigate to a NEW URL and return page content. Use this only when you need to load a different page. If the page is already open, use execute with document.body.innerText or document.documentElement.outerHTML instead.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch'
      },
      format: {
        type: 'string',
        enum: ['html', 'txt', 'markdown', 'json'],
        description: 'Output format (default: markdown)'
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in milliseconds (default: 10000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'If true, use private browsing mode where data is not persisted (default: false)'
      },
      newTab: {
        type: 'boolean',
        description:
          'If true, create a new tab for this request. Use this when fetching multiple URLs in parallel (default: false)'
      }
    },
    required: ['url']
  }
}

export async function handleFetch(controller: CdpBrowserController, args: unknown) {
  const { url, format, timeout, privateMode, newTab } = FetchSchema.parse(args)
  try {
    const content = await controller.fetch(url, format, timeout ?? 10000, privateMode ?? false, newTab ?? false)
    return successResponse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    return errorResponse(error as Error)
  }
}
