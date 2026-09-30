import os from 'node:os'

import { application } from '@application'

/** Live CLI children plus parked warm queries; tuned for ~16 GB Windows commit budgets. */
export const MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES = 6

const WINDOWS_LOW_FREE_MEMORY_RATIO = 0.1

export function isClaudeCodeSpawnMemoryPressured(): boolean {
  if (process.platform !== 'win32') return false
  const total = os.totalmem()
  if (total <= 0) return false
  return os.freemem() / total < WINDOWS_LOW_FREE_MEMORY_RATIO
}

/**
 * Live turns admit only while the active CLI count is under the cap; evicted warm children still
 * count until exit, so a new warm park must not start beside them or the physical process cap
 * would be exceeded.
 */
export type ClaudeCodeSpawnPriority = 'live' | 'warm'

/**
 * Drop parked warm queries before a live spawn so channel/idle prewarm cannot stack unbounded CLI
 * children on Windows. Warm parks are refused outright at the cap; evicting warm entries cannot
 * free a slot for another park before the evicted child exits. No-op when under the cap.
 */
export function prepareClaudeCodeSpawnCapacity(priority: ClaudeCodeSpawnPriority): boolean {
  const processManager = application.getExisting('ClaudeCodeProcessManager')
  const warmManager = application.getExisting('ClaudeCodeWarmQueryManager')
  if (!processManager || !warmManager) return true
  if (priority === 'warm') {
    return processManager.getActiveProcessCount() < MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES
  }
  while (
    processManager.getCapSlotProcessCount() >= MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES ||
    processManager.getActiveProcessCount() >= MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES
  ) {
    if (!warmManager.evictOldestWarmQuery()) return false
  }
  return (
    processManager.getCapSlotProcessCount() < MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES &&
    processManager.getActiveProcessCount() < MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES
  )
}
