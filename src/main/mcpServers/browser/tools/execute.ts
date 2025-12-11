import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const ExecuteSchema = z.object({
  code: z
    .string()
    .describe(
      'JavaScript evaluated via Chrome DevTools Runtime.evaluate. Keep it short; prefer one-line with semicolons for multiple statements.'
    ),
  timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  sessionId: z.string().optional().describe('Session identifier to target a specific page (default: default)')
})

export const executeToolDefinition = {
  name: 'execute',
  description:
    'Run JavaScript in the current page via Runtime.evaluate. Prefer short, single-line snippets; use semicolons for multiple statements.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'One-line JS to evaluate in page context'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default 5000)'
      },
      sessionId: {
        type: 'string',
        description: 'Session identifier; targets a specific page (default: default)'
      }
    },
    required: ['code']
  }
}

export async function handleExecute(controller: CdpBrowserController, args: unknown) {
  const { code, timeout, sessionId } = ExecuteSchema.parse(args)
  try {
    const value = await controller.execute(code, timeout, sessionId ?? 'default')
    return {
      content: [
        {
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value)
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
