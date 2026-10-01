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
 * A live turn may reuse the cap slot an eviction just freed — its child was signaled and is
 * draining — while a new warm park must not: evicted children still count until they exit, so a
 * park admitted beside them would overshoot the physical process cap.
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
  while (processManager.getCapSlotProcessCount() >= MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES) {
    if (!warmManager.evictOldestWarmQuery()) return false
  }
  return processManager.getActiveProcessCount() < MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES
}

const LIVE_SPAWN_CAPACITY_WAIT_MS = 30_000

/** Live cold starts may wait for evicted warm children to exit so the physical process cap holds. */
export async function ensureClaudeCodeSpawnCapacity(priority: ClaudeCodeSpawnPriority): Promise<boolean> {
  if (prepareClaudeCodeSpawnCapacity(priority)) return true
  if (priority === 'warm') return false

  const processManager = application.getExisting('ClaudeCodeProcessManager')
  if (!processManager) return false
  const deadline = Date.now() + LIVE_SPAWN_CAPACITY_WAIT_MS
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await processManager.waitForActiveProcessBelowCap(MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES, remaining)
    if (prepareClaudeCodeSpawnCapacity('live')) return true
  }
  return false
}
