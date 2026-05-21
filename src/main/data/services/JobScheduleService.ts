import { application } from '@application'
import { type InsertJobScheduleRow, type JobScheduleRow, jobScheduleTable } from '@data/db/schemas/job'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  type CatchUpPolicy,
  CatchUpPolicySchema,
  type CreateJobScheduleDto,
  JOB_ERROR_CODES,
  JobScheduleNameAtomSchema,
  type JobScheduleSnapshot,
  type Trigger,
  TriggerSchema,
  type UpdateJobScheduleDto
} from '@shared/data/api/schemas/jobs'
import { and, asc, eq, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('JobScheduleService')

export interface JobScheduleListFilter {
  type?: string
  enabled?: boolean
  limit?: number
  offset?: number
}

/**
 * Owning entity service for `jobScheduleTable`. JobManager and DataApi handlers
 * reach the table through this service — no direct Drizzle access elsewhere.
 *
 * Single-instance invariant: a type with `name=''` (singleton sentinel) is
 * DB-enforced via UNIQUE(type, name). The external API schema rejects `''`;
 * only this service writes `''` internally as the sentinel. `rowToSnapshot`
 * maps `''` back to `null` so the external snapshot contract stays
 * `string | null`.
 */
export class JobScheduleService {
  private getDb(): DbOrTx {
    return application.get('DbService').getDb()
  }

  // ---------------- Read ----------------

  async listAll(filter: JobScheduleListFilter = {}): Promise<JobScheduleSnapshot[]> {
    const db = this.getDb()
    const conditions: SQL[] = []
    if (filter.type) conditions.push(eq(jobScheduleTable.type, filter.type))
    if (filter.enabled !== undefined) conditions.push(eq(jobScheduleTable.enabled, filter.enabled))

    const baseQuery = conditions.length
      ? db
          .select()
          .from(jobScheduleTable)
          .where(and(...conditions))
          .orderBy(asc(jobScheduleTable.createdAt))
      : db.select().from(jobScheduleTable).orderBy(asc(jobScheduleTable.createdAt))

    const rows =
      filter.limit !== undefined
        ? filter.offset !== undefined
          ? await baseQuery.limit(filter.limit).offset(filter.offset)
          : await baseQuery.limit(filter.limit)
        : await baseQuery

    return rows.map((r) => this.rowToSnapshot(r))
  }

  async listEnabled(): Promise<JobScheduleSnapshot[]> {
    const rows = await this.getDb()
      .select()
      .from(jobScheduleTable)
      .where(eq(jobScheduleTable.enabled, true))
      .orderBy(asc(jobScheduleTable.createdAt))
    return rows.map((r) => this.rowToSnapshot(r))
  }

  async getById(id: string): Promise<JobScheduleSnapshot | null> {
    const [row] = await this.getDb().select().from(jobScheduleTable).where(eq(jobScheduleTable.id, id)).limit(1)
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * Resolve a schedule by (type, name). Pass `name=''` for singleton lookup.
   * Returns null when not found so the caller (JobManager) can wrap absence
   * into a typed error with a `knownNames` list for better DX.
   */
  async getByTypeAndName(type: string, name: string): Promise<JobScheduleSnapshot | null> {
    const [row] = await this.getDb()
      .select()
      .from(jobScheduleTable)
      .where(and(eq(jobScheduleTable.type, type), eq(jobScheduleTable.name, name)))
      .limit(1)
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * All known non-sentinel names for a type — JobManager uses this to build
   * error context. The singleton sentinel `''` is filtered out so callers see
   * only user-visible names.
   */
  async listNamesForType(type: string): Promise<string[]> {
    const rows = await this.getDb()
      .select({ name: jobScheduleTable.name })
      .from(jobScheduleTable)
      .where(eq(jobScheduleTable.type, type))
    return rows.map((r) => r.name).filter((n) => n !== '')
  }

  /**
   * Schedules eligible for catch-up evaluation. Phase 1 returns all enabled
   * schedules — JobManager applies the per-schedule policy. Filtering more
   * aggressively here would duplicate policy knowledge from JobManager.
   */
  async getCatchUpCandidates(): Promise<JobScheduleSnapshot[]> {
    return this.listEnabled()
  }

  // ---------------- Write ----------------

  async create(dto: CreateJobScheduleDto): Promise<JobScheduleSnapshot> {
    if (dto.name) {
      const parsed = JobScheduleNameAtomSchema.safeParse(dto.name)
      if (!parsed.success) {
        throw DataApiErrorFactory.invalidOperation(
          `${JOB_ERROR_CODES.SCHEDULE_NAME_INVALID}: Invalid schedule name: ${parsed.error.issues.map((i) => i.message).join('; ')}`
        )
      }
    }
    return this.insertSchedule(dto)
  }

  private async insertSchedule(dto: CreateJobScheduleDto): Promise<JobScheduleSnapshot> {
    // Drizzle's `text({ mode: 'json' })` columns accept JS values directly —
    // no manual JSON.stringify needed. The ORM serializes on write and parses
    // on read.
    const insertData: InsertJobScheduleRow = {
      type: dto.type,
      name: dto.name ?? '',
      trigger: dto.trigger,
      jobInputTemplate: dto.jobInputTemplate,
      catchUpPolicy: dto.catchUpPolicy,
      enabled: dto.enabled ?? true,
      metadata: dto.metadata ?? {}
    }

    const result = await withSqliteErrors(() => this.getDb().insert(jobScheduleTable).values(insertData).returning(), {
      ...defaultHandlersFor('JobSchedule', '<auto>'),
      unique: () =>
        DataApiErrorFactory.conflict(
          dto.name
            ? `${JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT}: name "${dto.name}" already exists for type "${dto.type}"`
            : `${JOB_ERROR_CODES.SCHEDULE_SINGLETON_EXISTS}: type "${dto.type}" already has a singleton schedule (no name)`,
          'JobSchedule'
        )
    })
    const row = result[0]
    if (!row) throw new Error('jobScheduleService.create returned no row')
    logger.info('JobSchedule created', { id: row.id, type: dto.type, name: dto.name })
    return this.rowToSnapshot(row)
  }

  async update(id: string, patch: UpdateJobScheduleDto): Promise<JobScheduleSnapshot | null> {
    if (patch.name) {
      const parsed = JobScheduleNameAtomSchema.safeParse(patch.name)
      if (!parsed.success) {
        throw DataApiErrorFactory.invalidOperation(
          `${JOB_ERROR_CODES.SCHEDULE_NAME_INVALID}: Invalid schedule name: ${parsed.error.issues.map((i) => i.message).join('; ')}`
        )
      }
    }

    const updateData: Partial<InsertJobScheduleRow> = { updatedAt: Date.now() }
    if (patch.name !== undefined) updateData.name = patch.name ?? ''
    if (patch.trigger !== undefined) updateData.trigger = patch.trigger
    if (patch.jobInputTemplate !== undefined) updateData.jobInputTemplate = patch.jobInputTemplate
    if (patch.catchUpPolicy !== undefined) updateData.catchUpPolicy = patch.catchUpPolicy
    if (patch.enabled !== undefined) updateData.enabled = patch.enabled
    if (patch.metadata !== undefined) updateData.metadata = patch.metadata

    const result = await withSqliteErrors(
      () => this.getDb().update(jobScheduleTable).set(updateData).where(eq(jobScheduleTable.id, id)).returning(),
      {
        ...defaultHandlersFor('JobSchedule', id),
        unique: () =>
          DataApiErrorFactory.conflict(
            `${JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT}: name "${patch.name}" already exists (id=${id})`,
            'JobSchedule'
          )
      }
    )
    const row = result[0]
    if (!row) return null
    logger.info('JobSchedule updated', { id })
    return this.rowToSnapshot(row)
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const result = await this.getDb()
      .update(jobScheduleTable)
      .set({ enabled, updatedAt: Date.now() })
      .where(eq(jobScheduleTable.id, id))
    return result.rowsAffected > 0
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.getDb().delete(jobScheduleTable).where(eq(jobScheduleTable.id, id))
    logger.info('JobSchedule deleted', { id, deleted: result.rowsAffected > 0 })
    return result.rowsAffected > 0
  }

  /**
   * Record a fire event: set lastRun to the actual fire timestamp and nextRun
   * to the next expected fire (or null for terminal one-shot / no-more-runs).
   * Called from the SchedulerService callback after each fire.
   */
  async markFired(id: string, lastRun: number, nextRun: number | null): Promise<void> {
    await this.getDb()
      .update(jobScheduleTable)
      .set({ lastRun, nextRun, updatedAt: Date.now() })
      .where(eq(jobScheduleTable.id, id))
  }

  // ---------------- Row → Entity ----------------

  /**
   * Row → entity mapping. Like JobService.rowToSnapshot, this is written
   * explicitly rather than via `{...nullsToUndefined(row)}` because the
   * snapshot fields are `.nullable()` (not `.optional()`) to keep the IPC
   * boundary clean. See JobService.rowToSnapshot for the rationale.
   */
  rowToSnapshot(row: JobScheduleRow): JobScheduleSnapshot {
    // Drizzle's `text({ mode: 'json' })` columns return parsed JS values.
    // `validateTrigger` / `validateCatchUpPolicy` still apply for **shape**
    // validation — they guard against schema drift between app versions, a
    // class of corruption JSON-syntax-parsing cannot catch.
    return {
      id: row.id,
      type: row.type,
      // Map the internal singleton sentinel `''` back to `null` so the external
      // snapshot contract (string | null) is preserved.
      name: row.name === '' ? null : row.name,
      trigger: this.validateTrigger(row.id, row.trigger),
      jobInputTemplate: row.jobInputTemplate,
      enabled: row.enabled,
      nextRun: row.nextRun != null ? timestampToISO(row.nextRun) : null,
      lastRun: row.lastRun != null ? timestampToISO(row.lastRun) : null,
      catchUpPolicy: this.validateCatchUpPolicy(row.id, row.catchUpPolicy),
      metadata: row.metadata,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  /**
   * Best-effort validate a row's trigger shape. A row that fails validation
   * (schema drift across app versions, manual DB edit) logs a warn and falls
   * back to a sentinel `once`-at-epoch trigger so SchedulerService does not
   * silently default to `interval` with `ms: undefined` (its else branch).
   * The sentinel will fire immediately on next arm — visible.
   */
  private validateTrigger(id: string, parsed: unknown): Trigger {
    const result = TriggerSchema.safeParse(parsed)
    if (result.success) return result.data
    logger.warn('JobSchedule trigger failed schema validation — using once-at-epoch sentinel', {
      id,
      issues: result.error.issues.map((i) => i.message)
    })
    return { kind: 'once', at: 0 }
  }

  private validateCatchUpPolicy(id: string, parsed: unknown): CatchUpPolicy {
    const result = CatchUpPolicySchema.safeParse(parsed)
    if (result.success) return result.data
    logger.warn('JobSchedule catchUpPolicy failed schema validation — defaulting to skip-missed', {
      id,
      issues: result.error.issues.map((i) => i.message)
    })
    return { kind: 'skip-missed' }
  }
}

export const jobScheduleService = new JobScheduleService()
