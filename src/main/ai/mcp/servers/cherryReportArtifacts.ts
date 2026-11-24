import path from 'node:path'

import { artifactService } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import { isOutsidePath } from '@main/utils/file'
import type { ReportArtifactsInput } from '@shared/ai/builtinTools'

const logger = loggerService.withContext('McpServer:CherryReportArtifacts')

export interface ReportArtifactsContext {
  agentId: string
  sessionId: string
  workspacePath: string
}

/**
 * Index the reported deliverables for the Agent's Outputs. The report itself always succeeds:
 * a failed index write is logged, never surfaced to the model.
 */
export function recordReportedArtifacts(
  context: ReportArtifactsContext,
  { artifacts }: Pick<ReportArtifactsInput, 'artifacts'>
): void {
  try {
    artifactService.recordAgentArtifacts(
      context.agentId,
      context.sessionId,
      artifacts.flatMap(({ path: reportedPath, description }) => {
        const filePath = path.resolve(context.workspacePath, reportedPath)
        const relativePath = path.relative(context.workspacePath, filePath)
        if (!relativePath || isOutsidePath(relativePath)) return []
        return [{ path: filePath, title: description ?? path.basename(filePath), size: null }]
      })
    )
  } catch (error) {
    logger.warn('Failed to index reported artifacts', { sessionId: context.sessionId, error })
  }
}
