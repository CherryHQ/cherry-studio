import { stat } from 'node:fs/promises'
import path from 'node:path'

import { artifactService } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import type { ReportArtifactsInput } from '@shared/ai/builtinTools'

const logger = loggerService.withContext('McpServer:CherryReportArtifacts')

export interface ReportArtifactsContext {
  agentId: string
  sessionId: string
  workspacePath: string
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await stat(filePath)
    return stats.isFile() ? stats.size : null
  } catch {
    return null
  }
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
      artifacts.map(async (artifact) => {
        const filePath = path.resolve(context.workspacePath, artifact.path)
        return {
          path: filePath,
          title: artifact.description ?? path.basename(filePath),
          size: await fileSize(filePath)
        }
      })
    )
    artifactService.recordAgentArtifacts(context.agentId, context.sessionId, reported)
  } catch (error) {
    logger.warn('Failed to index reported artifacts', { sessionId: context.sessionId, error })
  }
}

/**
 * Index the outputs created before the index existed, once. Runs in the background after start; a
 * failure is logged and retried on the next start, and never affects the Outputs list.
 */
export async function backfillPastOutputs(): Promise<void> {
  try {
    const reports = artifactService.findPastAgentReports()
    if (!reports) return
    const sized = await Promise.all(reports.map(async (report) => ({ ...report, size: await fileSize(report.path) })))
    artifactService.backfillPastOutputs(sized)
    logger.info('Backfilled past outputs', { agentReports: sized.length })
  } catch (error) {
    logger.warn('Failed to backfill past outputs', { error })
  }
}
