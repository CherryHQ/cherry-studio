import { loggerService } from '@logger'

import type { ToolResponse } from '../types'

const logger = loggerService.withContext('MacMCP')

export function successResponse(data: unknown): ToolResponse {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    isError: false
  }
}

export function errorResponse(message: string): ToolResponse {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

function isPermissionError(error: Error): boolean {
  return /not allowed|not authorized|permission denied|access.*denied/i.test(error.message)
}

export function handleAppleScriptError(error: unknown, tool: string, operation: string): ToolResponse {
  const err = error as Error

  logger.error('AppleScript tool error', {
    tool,
    operation,
    error: err.message
  })

  if (isPermissionError(err)) {
    return errorResponse(
      `Permission denied. Please grant Cherry Studio access to ${tool} in System Preferences > Privacy & Security > Automation.`
    )
  }

  if (err.message.includes('ETIMEDOUT') || err.message.includes('timed out')) {
    return errorResponse(`Operation timed out. The ${tool} app may be unresponsive.`)
  }

  return errorResponse(`Failed to ${operation} in ${tool}: ${err.message}`)
}

export function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}
