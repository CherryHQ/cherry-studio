import { application } from '@application'
import { englishLearningImportService } from '@data/services/EnglishLearningImportService'
import { learningSourceService } from '@data/services/LearningSourceService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { learningExtractionService } from './extraction/LearningExtractionService'

const logger = loggerService.withContext('EnglishLearningService')
const EXTRACTION_POLL_INTERVAL_MS = 30_000
const EXTRACTION_POLICY_VERSION = 4
const EXTRACTION_POLICY_VERSION_CACHE_KEY = 'feature.english_learning.extraction_policy_version'

@Injectable('EnglishLearningService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService'])
export class EnglishLearningService extends BaseService {
  private shuttingDown = false
  private allReady = false
  private enabled = true
  private backfillWork: Promise<void> | undefined
  private extractionWork: Promise<void> | undefined
  private extractionController: AbortController | undefined

  protected onInit(): void {
    this.shuttingDown = false
    this.allReady = false
    const preferenceService = application.get('PreferenceService')
    this.enabled = preferenceService.get('feature.english_learning.enabled')
    learningSourceService.requeueInterrupted()
    this.upgradeExtractionPolicy()
    this.registerInterval(
      () => (this.enabled ? this.drainPendingSources() : Promise.resolve()),
      EXTRACTION_POLL_INTERVAL_MS
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.english_learning.enabled', (enabled) => {
        this.enabled = enabled
        if (!enabled) {
          this.extractionController?.abort(new Error('English learning was disabled'))
        } else if (this.allReady) {
          if (this.backfillWork) {
            void this.backfillWork.then(() => {
              if (this.enabled) this.startBackfillAndDrain()
            })
          } else {
            this.startBackfillAndDrain()
          }
        }
      })
    )
  }

  private upgradeExtractionPolicy(): void {
    const cacheService = application.get('CacheService')
    const appliedVersion = cacheService.getPersist(EXTRACTION_POLICY_VERSION_CACHE_KEY)
    if (appliedVersion >= EXTRACTION_POLICY_VERSION) return

    const requeued = learningSourceService.requeueForExtractionPolicyUpgrade()
    cacheService.setPersist(EXTRACTION_POLICY_VERSION_CACHE_KEY, EXTRACTION_POLICY_VERSION)
    logger.info('Upgraded English learning extraction policy', {
      fromVersion: appliedVersion,
      toVersion: EXTRACTION_POLICY_VERSION,
      requeued
    })
  }

  protected onAllReady(): void {
    this.allReady = true
    const handle = setImmediate(() => {
      if (this.shuttingDown || !this.enabled) return
      this.startBackfillAndDrain()
    })
    this.registerDisposable(() => clearImmediate(handle))
  }

  protected async onStop(): Promise<void> {
    this.shuttingDown = true
    this.allReady = false
    this.extractionController?.abort(new Error('English learning service stopped'))
    await this.backfillWork
    await this.extractionWork
    this.backfillWork = undefined
    this.extractionWork = undefined
    this.extractionController = undefined
  }

  private startBackfillAndDrain(): void {
    if (this.backfillWork || this.shuttingDown || !this.enabled) return
    this.backfillWork = this.backfillHistories()
      .then(() => this.drainPendingSources())
      .finally(() => {
        this.backfillWork = undefined
      })
  }

  private drainPendingSources(): Promise<void> {
    if (this.shuttingDown || !this.enabled) return Promise.resolve()
    if (this.extractionWork) return this.extractionWork

    this.extractionController = new AbortController()
    const signal = this.extractionController.signal
    this.extractionWork = this.runExtractionLoop(signal).finally(() => {
      this.extractionWork = undefined
      this.extractionController = undefined
    })
    return this.extractionWork
  }

  private async runExtractionLoop(signal: AbortSignal): Promise<void> {
    while (!this.shuttingDown && this.enabled && !signal.aborted) {
      const pending = learningSourceService.list({ limit: 20, status: 'pending' }).items
      if (pending.length === 0) return

      for (const source of pending) {
        if (this.shuttingDown || !this.enabled || signal.aborted) return
        try {
          await learningExtractionService.processSource(source.id, { signal })
        } catch (error) {
          logger.warn('Failed to extract one learning source; continuing with remaining sources', {
            sourceId: source.id,
            error
          })
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  private async backfillHistories(): Promise<void> {
    try {
      const translations = await this.importAllBatches((cursor) =>
        englishLearningImportService.importTranslationBatch(cursor)
      )
      const selectionActions = await this.importAllBatches((cursor) =>
        englishLearningImportService.importSelectionActionBatch(cursor)
      )
      logger.info('Completed English learning history backfill', { translations, selectionActions })
    } catch (error) {
      logger.error('Failed English learning history backfill; it will retry on next launch', error as Error)
    }
  }

  private async importAllBatches(
    importBatch: (cursor?: string) => { nextCursor?: string; registered: number }
  ): Promise<number> {
    let cursor: string | undefined
    let registered = 0

    do {
      if (this.shuttingDown || !this.enabled) return registered
      const result = importBatch(cursor)
      registered += result.registered
      cursor = result.nextCursor
      if (cursor) await new Promise<void>((resolve) => setImmediate(resolve))
    } while (cursor)

    return registered
  }
}
