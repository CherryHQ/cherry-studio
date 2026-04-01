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
  selector: z
    .string()
    .optional()
    .describe(
      'CSS selector to extract content from (e.g. "#search" for Google results). Only used when format is set.'
    ),
  maxChars: z
    .number()
    .optional()
    .describe(
      'Maximum characters to return. Content is truncated with notice if exceeded. Only used when format is set.'
    ),
  timeout: z.number().optional().describe('Navigation timeout in ms (default: 10000)'),
  privateMode: z.boolean().optional().describe('Use incognito mode, no data persisted (default: false)'),
  newTab: z.boolean().optional().describe('Open in new tab, required for parallel requests (default: false)'),
  showWindow: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Show browser window (default: false). Set true only when the user needs to see or interact with the page (e.g. login, CAPTCHA).'
    )
})

export const openToolDefinition = {
  name: 'open',
  description:
    'Navigate to a URL and optionally fetch page content. By default the browser runs in the background (no window shown). If format is specified, returns { tabId, content } with page content in that format. Otherwise, returns { currentUrl, title, tabId } for subsequent operations. Use selector to extract only part of a page (e.g. "#search" for Google results). Set showWindow=true ONLY when the user needs to visually see or interact with the page (e.g. login, CAPTCHA, manual browsing). PARALLEL: Set newTab=true and call this tool multiple times simultaneously when visiting multiple URLs.',
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
      selector: {
        type: 'string',
        description:
          'CSS selector to extract content from (e.g. "#search" for Google results). Only used when format is set.'
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return. Truncated with notice if exceeded. Only used when format is set.'
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
        description:
          'Show browser window (default: false). Set true only when the user needs to see or interact with the page (e.g. login, CAPTCHA).'
      }
    },
    required: ['url']
  }
}

export async function handleOpen(controller: CdpBrowserController, args: unknown) {
  try {
    const { url, format, selector, maxChars, timeout, privateMode, newTab, showWindow } = OpenSchema.parse(args)

    if (format) {
      const { tabId, content } = await controller.fetch(
        url,
        format,
        timeout ?? 10000,
        privateMode ?? false,
        newTab ?? false,
        showWindow,
        selector
      )

      let finalContent = content
      if (maxChars && typeof finalContent === 'string' && finalContent.length > maxChars) {
        finalContent = finalContent.slice(0, maxChars) + '\n... [truncated at ' + maxChars + ' chars]'
      }

      return successResponse(JSON.stringify({ tabId, content: finalContent }))
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
