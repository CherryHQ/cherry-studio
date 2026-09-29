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
 * Drop parked warm queries before spawning so channel/idle prewarm cannot stack unbounded CLI
 * children on Windows. No-op when under the cap.
 */
export function prepareClaudeCodeSpawnCapacity(): boolean {
  const processManager = application.getExisting('ClaudeCodeProcessManager')
  const warmManager = application.getExisting('ClaudeCodeWarmQueryManager')
  if (!processManager || !warmManager) return true
  while (processManager.getActiveProcessCount() >= MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES) {
    if (!warmManager.evictOldestWarmQuery()) return false
  }
  return processManager.getActiveProcessCount() < MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES
}
