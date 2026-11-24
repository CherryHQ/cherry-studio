import path from 'node:path'

import { artifactService } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import type { ReportArtifactsInput } from '@shared/ai/builtinTools'

const logger = loggerService.withContext('McpServer:CherryReportArtifacts')

export interface ReportArtifactsContext {
  agentId: string
  sessionId: string
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
      artifacts.map(({ path: reportedPath, description }) => ({
        path: reportedPath,
        title: description ?? path.basename(reportedPath),
        size: null
      }))
    )
  } catch (error) {
    logger.warn('Failed to index reported artifacts', { sessionId: context.sessionId, error })
  }
}
