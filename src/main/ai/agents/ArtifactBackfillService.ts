import { artifactService, type PreparedPastAgentReport } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { prepareAgentArtifact } from './agentArtifactFile'

const logger = loggerService.withContext('ArtifactBackfillService')
const STARTUP_DELAY_MS = 5_000

/** Prepares historical files without holding a DB transaction. The index and journal commit together. */
export async function backfillPastOutputs(signal?: AbortSignal): Promise<void> {
  if (artifactService.hasBackfilledPastOutputs()) return
  const reports: PreparedPastAgentReport[] = []
  for (const { sessionId, workspacePath, path, title, reportedAt } of artifactService.readPastAgentReports()) {
    signal?.throwIfAborted()
    const artifact = await prepareAgentArtifact(workspacePath, path, title)
    if (artifact) reports.push({ ...artifact, sessionId, reportedAt })
  }
  signal?.throwIfAborted()
  artifactService.commitPastOutputs(reports, artifactService.readPastAssistantImages())
}

@Injectable('ArtifactBackfillService')
@ServicePhase(Phase.WhenReady)
export class ArtifactBackfillService extends BaseService {
  private readonly abortController = new AbortController()
  private work?: Promise<void>

  protected override onAllReady(): void {
    const signal = this.abortController.signal
    const handle = setTimeout(() => {
      if (signal.aborted) return
      this.work = backfillPastOutputs(signal).catch((error: unknown) => {
        if (!signal.aborted) logger.warn('Historical outputs will be retried next launch', error as Error)
      })
    }, STARTUP_DELAY_MS)
    handle.unref()
    this.registerDisposable(() => clearTimeout(handle))
  }

  protected override async onStop(): Promise<void> {
    this.abortController.abort()
    await this.work
  }
}
