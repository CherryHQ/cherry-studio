import { stat } from 'node:fs/promises'
import path from 'node:path'

import { normalizeWorkspacePath } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'

const logger = loggerService.withContext('ProtocolService:openWorkspace')

export async function prepareWorkspaceRoute(directoryPath: string): Promise<string | undefined> {
  if (!directoryPath || directoryPath.includes('\0') || !path.isAbsolute(directoryPath)) return undefined

  try {
    const normalizedPath = normalizeWorkspacePath(directoryPath)
    const supplied = await stat(directoryPath, { bigint: true })
    const normalized = await stat(normalizedPath, { bigint: true })
    if (!supplied.isDirectory() || !normalized.isDirectory()) return undefined
    if (supplied.dev !== normalized.dev || supplied.ino !== normalized.ino) return undefined

    const workspace = agentWorkspaceStorageService.registerWorkspace(normalizedPath)
    return `/app/agents?workspaceId=${encodeURIComponent(workspace.id)}`
  } catch (error) {
    logger.warn('Dropped workspace open request', error as Error)
    return undefined
  }
}
