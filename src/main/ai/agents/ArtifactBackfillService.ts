import { artifactService, type PreparedPastAgentReport } from '@data/services/ArtifactService'
import { loggerService } from '@logger'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase, toDisposable } from '@main/core/lifecycle'

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
  private readonly inFlightWork = createInFlightWorkTracker()
  private pauseHolds = 0
  private due = false

  pause(): Disposable {
    this.pauseHolds++
    return toDisposable(() => {
      this.pauseHolds--
      this.startWhenReady()
    })
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ settled: boolean }> {
    return { settled: await this.inFlightWork.drain(options) }
  }

  protected override onAllReady(): void {
    const handle = setTimeout(() => {
      this.due = true
      this.startWhenReady()
    }, STARTUP_DELAY_MS)
    handle.unref()
    this.registerDisposable(() => clearTimeout(handle))
  }

  protected override async onStop(): Promise<void> {
    this.abortController.abort()
    await this.inFlightWork.drain()
  }

  private startWhenReady(): void {
    const signal = this.abortController.signal
    if (!this.due || this.pauseHolds > 0 || signal.aborted) return
    this.due = false
    void this.inFlightWork.track(
      backfillPastOutputs(signal).catch((error: unknown) => {
        if (!signal.aborted) logger.warn('Historical outputs will be retried next launch', error as Error)
      })
    )
  }
}
