import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const FetchSchema = z.object({
  url: z.url().describe('URL to fetch'),
  format: z.enum(['html', 'txt', 'markdown', 'json']).default('markdown').describe('Output format (default: markdown)'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)'),
  sessionId: z.string().optional().describe('Session identifier (default: default)')
})

export const fetchToolDefinition = {
  name: 'fetch',
  description: 'Fetch a URL using the browser and return content in specified format (html, txt, markdown, json)',
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
      sessionId: {
        type: 'string',
        description: 'Session identifier (default: default)'
      }
    },
    required: ['url']
  }
}

export async function handleFetch(controller: CdpBrowserController, args: unknown) {
  const { url, format, timeout, sessionId } = FetchSchema.parse(args)
  try {
    const content = await controller.fetch(url, format, timeout ?? 10000, sessionId ?? 'default')
    return {
      content: [
        {
          type: 'text',
          text: typeof content === 'string' ? content : JSON.stringify(content)
        }
      ],
      isError: false
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: (error as Error).message
        }
      ],
      isError: true
    }
  }
}
