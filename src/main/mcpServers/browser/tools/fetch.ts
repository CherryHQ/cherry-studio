import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { errorResponse, successResponse } from './utils'

export const FetchSchema = z.object({
  url: z.url().describe('URL to fetch content from'),
  format: z.enum(['html', 'txt', 'markdown', 'json']).default('markdown').describe('Output format (default: markdown)'),
  timeout: z.number().optional().describe('Navigation timeout in ms (default: 10000)'),
  privateMode: z.boolean().optional().describe('Use incognito mode, no data persisted (default: false)'),
  newTab: z.boolean().optional().describe('Fetch in new tab, required for parallel requests (default: false)'),
  showWindow: z.boolean().optional().describe('Show browser window (default: false)')
})

export const fetchToolDefinition = {
  name: 'fetch',
  description:
    'Navigate to a URL and return page content in one step. Best for reading web pages when you only need the content. For pages requiring login or interaction, use open + execute instead. Set newTab=true when fetching multiple URLs in parallel.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch content from'
      },
      format: {
        type: 'string',
        enum: ['html', 'txt', 'markdown', 'json'],
        description: 'Output format: markdown (readable), txt (plain text), html (raw), json (parsed)'
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
        description: 'Fetch in new tab, required for parallel requests (default: false)'
      },
      showWindow: {
        type: 'boolean',
        description: 'Show browser window (default: false)'
      }
    },
    required: ['url']
  }
}

export async function handleFetch(controller: CdpBrowserController, args: unknown) {
  const { url, format, timeout, privateMode, newTab, showWindow } = FetchSchema.parse(args)
  try {
    const content = await controller.fetch(
      url,
      format,
      timeout ?? 10000,
      privateMode ?? false,
      newTab ?? false,
      showWindow ?? false
    )
    return successResponse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    return errorResponse(error as Error)
  }
}
