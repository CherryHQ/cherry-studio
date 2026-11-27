import { OpenSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export async function handleOpen(controller: BrowserController, args: unknown, signal?: AbortSignal) {
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
        selector,
        signal
      )

      let finalContent = content
      if (maxChars && typeof finalContent === 'string' && finalContent.length > maxChars) {
        finalContent = finalContent.slice(0, maxChars) + '\n... [truncated at ' + maxChars + ' chars]'
      }

      return successResponse(JSON.stringify({ tabId, content: finalContent }))
    } else {
      const res = await controller.open(
        url,
        timeout ?? 10000,
        privateMode ?? false,
        newTab ?? false,
        showWindow,
        signal
      )
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
