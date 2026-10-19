import { application } from '@application'
import { ListDownloadsSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

/**
 * Status-only tool: it reads the queue and never touches the browser.
 *
 * The rate comes from the manager's in-memory meter rather than the task row,
 * because the row only records bytes and a consumer cannot turn a single
 * cumulative number into a speed.
 */
export async function handleListDownloads(_controller: BrowserController, args: unknown) {
  try {
    const { taskId, limit } = ListDownloadsSchema.parse(args)
    const manager = application.get('DownloadManagerService')
    const downloads = manager.snapshot({ taskId, limit })
    if (taskId && downloads.length === 0) return errorResponse(`download not found: ${taskId}`)

    const active = downloads.filter((task) => task.state === 'downloading' || task.state === 'probing').length
    const totalSpeedBytesPerSecond = downloads.reduce((sum, task) => sum + task.speedBytesPerSecond, 0)
    return successResponse(JSON.stringify({ active, totalSpeedBytesPerSecond, downloads }))
  } catch (error) {
    logger.error('List downloads failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
