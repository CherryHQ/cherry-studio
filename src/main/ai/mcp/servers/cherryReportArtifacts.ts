import { artifactService } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import { prepareAgentArtifact } from '@main/ai/agents/agentArtifactFile'
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
export async function recordReportedArtifacts(
  context: ReportArtifactsContext,
  { artifacts }: Pick<ReportArtifactsInput, 'artifacts'>
): Promise<void> {
  try {
    const reported = await Promise.all(
      artifacts.map((artifact) => prepareAgentArtifact(context.workspacePath, artifact.path, artifact.description))
    )
    artifactService.recordAgentArtifacts(
      context.agentId,
      context.sessionId,
      reported.filter((artifact) => artifact !== undefined)
    )
  } catch (error) {
    logger.warn('Failed to index reported artifacts', { sessionId: context.sessionId, error })
  }
}
