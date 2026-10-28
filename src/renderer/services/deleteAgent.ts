import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('deleteAgent')

/**
 * Delete an Agent while keeping every renderer view of that Agent coherent.
 *
 * The IPC command is the source of truth for the mixed-effect deletion. Cache
 * refresh is intentionally best-effort because a committed deletion must not
 * be reported as failed merely because a renderer revalidation failed.
 */
export async function deleteAgentAndRefresh(
  agentId: string,
  refresh: (paths: string[]) => Promise<unknown>
): Promise<void> {
  await ipcApi.request('ai.agent.delete', { agentId, deleteSessions: false })
  try {
    await refresh(['/agents', `/agents/${agentId}`, '/agent-sessions', '/agent-channels', '/pins'])
  } catch (error) {
    logger.warn('Failed to refresh after deleting Agent', { agentId, error })
  }
}
