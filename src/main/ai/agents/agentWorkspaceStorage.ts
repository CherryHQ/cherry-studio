import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

import { WORKSPACE_ARCHIVE_SUFFIXES } from './agentWorkspaceArchive'

export async function withSystemWorkspaceStorage<T>(
  workspace: string,
  operation: () => Promise<T>,
  orphan = false
): Promise<T | undefined> {
  const release = agentWorkspaceService.reserveStorageMutation(
    ['', ...WORKSPACE_ARCHIVE_SUFFIXES].map((suffix) => `${workspace}${suffix}`),
    orphan ? undefined : workspace
  )
  if (!release) return undefined
  try {
    return await operation()
  } finally {
    release()
  }
}
