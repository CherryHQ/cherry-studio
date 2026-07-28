import path from 'node:path'

import { application } from '@application'
import { learningExternalSyncTable } from '@data/db/schemas/learningExternalSync'
import { learningUnitTable } from '@data/db/schemas/learningUnit'
import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { reviewCardTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { atomicWriteFile, ensureDir, stat } from '@main/utils/file'
import type { LearningUnit } from '@shared/data/types/englishLearning'
import type { FilePath } from '@shared/types/file'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'

import { renderDailyLearningLog, renderLearningUnitNote, renderObsidianDashboard } from './obsidianMarkdown'

const logger = loggerService.withContext('ObsidianLearningSyncService')
const SYNC_INTERVAL_MS = 60_000
const SYNC_BATCH_SIZE = 100

function timestampToIso(value: number): string {
  return new Date(value).toISOString()
}

function rowToUnit(row: typeof learningUnitTable.$inferSelect): LearningUnit {
  return {
    id: row.id,
    kind: row.kind,
    english: row.english,
    normalizedEnglish: row.normalizedEnglish,
    meaning: row.meaning,
    usageNote: row.usageNote,
    example: row.example,
    tags: row.tags,
    cefr: row.cefr,
    exactHash: row.exactHash,
    extractionConfidence: row.extractionConfidence,
    isUserEdited: row.isUserEdited,
    suspended: row.suspended,
    createdAt: timestampToIso(row.createdAt),
    updatedAt: timestampToIso(row.updatedAt)
  }
}

export function resolveObsidianMirrorRoot(vaultPath: string, folder: string): string {
  if (!path.isAbsolute(vaultPath)) throw new Error('Obsidian vault path must be absolute')
  if (!folder.trim() || path.isAbsolute(folder)) throw new Error('Obsidian mirror folder must be relative')
  const vaultRoot = path.resolve(vaultPath)
  const mirrorRoot = path.resolve(vaultRoot, folder)
  const relative = path.relative(vaultRoot, mirrorRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Obsidian mirror folder must stay inside the selected vault')
  }
  return mirrorRoot
}

@Injectable('ObsidianLearningSyncService')
@ServicePhase(Phase.WhenReady)
export class ObsidianLearningSyncService extends BaseService {
  private work: Promise<void> | null = null
  private stopping = false

  protected onInit(): void {
    this.stopping = false
    this.registerInterval(async () => {
      await this.sync()
    }, SYNC_INTERVAL_MS)
  }

  protected onAllReady(): void {
    void this.sync()
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    await this.work
  }

  sync(): Promise<void> {
    if (this.work) return this.work
    if (this.stopping || !application.get('PreferenceService').get('feature.english_learning.obsidian.enabled')) {
      return Promise.resolve()
    }
    this.work = this.runSync()
      .catch((error) => logger.error('Obsidian learning mirror failed', error as Error))
      .finally(() => {
        this.work = null
      })
    return this.work
  }

  private async runSync(): Promise<void> {
    const preferences = application.get('PreferenceService')
    const vaultPath = preferences.get('feature.english_learning.obsidian.vault_path')
    const mirrorRoot = resolveObsidianMirrorRoot(vaultPath, preferences.get('feature.english_learning.obsidian.folder'))
    const vaultStat = await stat(path.resolve(vaultPath) as FilePath)
    if (!vaultStat.isDirectory) throw new Error('Configured Obsidian vault path is not a directory')

    const unitsDirectory = path.join(mirrorRoot, 'Units')
    const dailyDirectory = path.join(mirrorRoot, 'Daily')
    await ensureDir(unitsDirectory as FilePath)
    await ensureDir(dailyDirectory as FilePath)
    await this.syncUnits(unitsDirectory)
    await atomicWriteFile(path.join(mirrorRoot, 'Dashboard.md') as FilePath, renderObsidianDashboard())
    await this.syncDailyLog(dailyDirectory)
  }

  private async syncUnits(unitsDirectory: string): Promise<void> {
    const db = application.get('DbService').getDb()
    const rows = db.select().from(learningUnitTable).all()
    application.get('DbService').withWriteTx((tx) => {
      for (const unit of rows) {
        const sourceRevision = `${unit.updatedAt}:${unit.exactHash}`
        const existing = tx
          .select()
          .from(learningExternalSyncTable)
          .where(
            and(eq(learningExternalSyncTable.learningUnitId, unit.id), eq(learningExternalSyncTable.target, 'obsidian'))
          )
          .limit(1)
          .get()
        if (!existing) {
          tx.insert(learningExternalSyncTable)
            .values({ learningUnitId: unit.id, target: 'obsidian', state: 'pending', sourceRevision })
            .run()
        } else if (existing.sourceRevision !== sourceRevision) {
          tx.update(learningExternalSyncTable)
            .set({ sourceRevision, state: 'pending', error: null })
            .where(eq(learningExternalSyncTable.id, existing.id))
            .run()
        }
      }
    })

    const pending = db
      .select({ sync: learningExternalSyncTable, unit: learningUnitTable })
      .from(learningExternalSyncTable)
      .innerJoin(learningUnitTable, eq(learningUnitTable.id, learningExternalSyncTable.learningUnitId))
      .where(
        and(
          eq(learningExternalSyncTable.target, 'obsidian'),
          inArray(learningExternalSyncTable.state, ['pending', 'failed'])
        )
      )
      .limit(SYNC_BATCH_SIZE)
      .all()

    for (const { sync, unit } of pending) {
      if (this.stopping) return
      const target = path.join(unitsDirectory, `${unit.id}.md`)
      try {
        await atomicWriteFile(target as FilePath, renderLearningUnitNote(rowToUnit(unit)))
        db.update(learningExternalSyncTable)
          .set({
            state: 'synced',
            externalPath: target,
            syncedRevision: sync.sourceRevision,
            error: null
          })
          .where(eq(learningExternalSyncTable.id, sync.id))
          .run()
      } catch (error) {
        db.update(learningExternalSyncTable)
          .set({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
          .where(eq(learningExternalSyncTable.id, sync.id))
          .run()
      }
    }
  }

  private async syncDailyLog(dailyDirectory: string): Promise<void> {
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const db = application.get('DbService').getDb()
    const reviews = db
      .select({
        english: learningUnitTable.english,
        rating: reviewEventTable.rating,
        direction: reviewCardTable.direction
      })
      .from(reviewEventTable)
      .innerJoin(reviewCardTable, eq(reviewCardTable.id, reviewEventTable.cardId))
      .innerJoin(learningUnitTable, eq(learningUnitTable.id, reviewCardTable.learningUnitId))
      .where(and(gte(reviewEventTable.reviewedAt, start.getTime()), lt(reviewEventTable.reviewedAt, end.getTime())))
      .all()
    const practices = db
      .select({
        mode: practiceSessionTable.mode,
        durationMs: practiceSessionTable.durationMs,
        scenario: practiceSessionTable.scenario
      })
      .from(practiceSessionTable)
      .where(
        and(gte(practiceSessionTable.startedAt, start.getTime()), lt(practiceSessionTable.startedAt, end.getTime()))
      )
      .all()
    const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
      start.getDate()
    ).padStart(2, '0')}`
    await atomicWriteFile(
      path.join(dailyDirectory, `${date}.md`) as FilePath,
      renderDailyLearningLog({ date, reviews, practices })
    )
  }
}
