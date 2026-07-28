import { englishLearningImportService } from '@data/services/EnglishLearningImportService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('EnglishLearningService')

@Injectable('EnglishLearningService')
@ServicePhase(Phase.WhenReady)
export class EnglishLearningService extends BaseService {
  private shuttingDown = false
  private backfillWork: Promise<void> | undefined

  protected onInit(): void {
    this.shuttingDown = false
  }

  protected onAllReady(): void {
    const handle = setImmediate(() => {
      if (this.shuttingDown) return
      this.backfillWork = this.backfillHistories()
    })
    this.registerDisposable(() => clearImmediate(handle))
  }

  protected async onStop(): Promise<void> {
    this.shuttingDown = true
    await this.backfillWork
    this.backfillWork = undefined
  }

  private async backfillHistories(): Promise<void> {
    try {
      const translations = await this.importAllBatches((cursor) =>
        englishLearningImportService.importTranslationBatch(cursor)
      )
      const selectionRefines = await this.importAllBatches((cursor) =>
        englishLearningImportService.importSelectionRefineBatch(cursor)
      )
      logger.info('Completed English learning history backfill', { translations, selectionRefines })
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
      if (this.shuttingDown) return registered
      const result = importBatch(cursor)
      registered += result.registered
      cursor = result.nextCursor
      if (cursor) await new Promise<void>((resolve) => setImmediate(resolve))
    } while (cursor)

    return registered
  }
}
