import { and, count, eq, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTaskRunTable as table, type InsertAgentTaskRunRow } from '@data/db/schemas/agentTaskRun'
import type { DbOrTx } from '@data/db/types'
import {
  DASHBOARD_RETENTION_MS,
  type DashboardEntry,
  type DashboardFinalStatus,
  type DashboardPage,
  type DashboardRun
} from '@shared/data/api/schemas/agentTaskDashboard'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering, parseCursor } from './utils/keysetCursor'

const active = () => inArray(table.status, ['queued', 'running'])
const awaiting = () => and(isNotNull(table.endedAt), isNull(table.viewedAt))
const notifyChanged = () => notifyDataApiDataChange([{ endpoint: '/agent-task-dashboard', kind: 'membership' }])

class AgentTaskRunService {
  private get db() {
    return application.get('DbService').getDb()
  }

  getById(id: string): DashboardRun | undefined {
    return this.db.select().from(table).where(eq(table.id, id)).get()
  }

  getByRun(source: DashboardRun['source'], runId: string): DashboardRun | undefined {
    return this.db
      .select()
      .from(table)
      .where(and(eq(table.source, source), eq(table.runId, runId)))
      .get()
  }

  listActive(): DashboardRun[] {
    return this.db.select().from(table).where(active()).all()
  }

  create(input: InsertAgentTaskRunRow): DashboardRun {
    const row = this.db.insert(table).values(input).onConflictDoNothing().returning().get()
    if (row) notifyChanged()
    return row ?? this.getByRun(input.source, input.runId)!
  }

  updateActive(
    id: string,
    patch: Partial<
      Pick<DashboardRun, 'sessionId' | 'startedAt' | 'lastActivityAt' | 'status' | 'blockedOn' | 'messageAnchor'>
    >
  ): void {
    if (
      this.db
        .update(table)
        .set(patch)
        .where(and(eq(table.id, id), active()))
        .run().changes
    )
      notifyChanged()
  }

  finish(
    id: string,
    status: DashboardFinalStatus,
    patch: Pick<DashboardRun, 'endedAt'> &
      Partial<Pick<DashboardRun, 'messageAnchor' | 'reasonCode' | 'errorSummary' | 'viewedAt'>>
  ): void {
    if (
      this.db
        .update(table)
        .set({ ...patch, status, blockedOn: null })
        .where(and(eq(table.id, id), active()))
        .run().changes
    )
      notifyChanged()
  }

  heartbeat(ids: string[], now: number): void {
    if (ids.length)
      this.db
        .update(table)
        .set({ lastActivityAt: now })
        .where(and(inArray(table.id, ids), eq(table.status, 'running')))
        .run()
  }

  review(
    input: { id?: string; taskId?: string; sessionId?: string; through?: number; automatic?: boolean },
    now = Date.now()
  ): void {
    const where = and(
      awaiting(),
      lte(table.endedAt, input.through ?? now),
      input.id ? eq(table.id, input.id) : undefined,
      input.taskId ? eq(table.taskId, input.taskId) : undefined,
      input.sessionId ? eq(table.sessionId, input.sessionId) : undefined,
      input.automatic ? or(isNull(table.reasonCode), ne(table.reasonCode, 'user_cancelled')) : undefined
    )
    if (this.db.update(table).set({ viewedAt: now }).where(where).run().changes) notifyChanged()
  }

  reviewDeletedTx(
    tx: DbOrTx,
    input: { agentId?: string; taskId?: string; sessionIds?: string[] },
    now = Date.now()
  ): void {
    const filters = [
      input.agentId ? eq(table.agentId, input.agentId) : undefined,
      input.taskId ? eq(table.taskId, input.taskId) : undefined,
      input.sessionIds?.length ? inArray(table.sessionId, input.sessionIds) : undefined
    ].filter((filter) => filter !== undefined)
    if (!filters.length) return
    tx.update(table)
      .set({ viewedAt: now })
      .where(and(isNull(table.viewedAt), ...filters))
      .run()
  }

  notifyChanged(): void {
    notifyChanged()
  }

  purgeViewed(now = Date.now()): void {
    this.db
      .delete(table)
      .where(lte(table.viewedAt, now - DASHBOARD_RETENTION_MS))
      .run()
  }

  list(group: 'running' | 'awaiting', cursor?: string): DashboardPage {
    const running = this.db.select().from(table).where(eq(table.status, 'running')).all()
    const groups = new Map<string, DashboardEntry>()
    const latestStarts = new Map<string, number>()
    for (const row of running) {
      const key = `${row.source}:${row.source === 'scheduled' ? (row.taskId ?? row.runId) : (row.sessionId ?? row.runId)}`
      const current = groups.get(key)
      const latestStart = latestStarts.get(key) ?? -Infinity
      const latest =
        !current ||
        (row.startedAt ?? 0) > latestStart ||
        ((row.startedAt ?? 0) === latestStart && row.runId.localeCompare(current.runId) > 0)
          ? row
          : current
      latestStarts.set(key, Math.max(latestStart, row.startedAt ?? 0))
      groups.set(key, {
        ...latest,
        id: key,
        startedAt:
          current?.startedAt != null && row.startedAt != null
            ? Math.min(current.startedAt, row.startedAt)
            : (current?.startedAt ?? row.startedAt),
        blockedOn: row.blockedOn ?? current?.blockedOn ?? null,
        runIds: [...(current?.runIds ?? []), row.id],
        runCount: (current?.runCount ?? 0) + 1
      })
    }
    const totals = {
      running: groups.size,
      awaiting: this.db.select({ count: count() }).from(table).where(awaiting()).get()!.count
    }
    if (group === 'running') {
      const latestStart = (entry: DashboardEntry) => latestStarts.get(entry.id) ?? 0
      const entries = [...groups.values()].sort(
        (a, b) =>
          Number(!!b.blockedOn) - Number(!!a.blockedOn) || latestStart(b) - latestStart(a) || a.id.localeCompare(b.id)
      )
      const parsedBoundary = parseCursor(cursor, (value) => {
        try {
          const parsed: unknown = JSON.parse(value)
          return Array.isArray(parsed) &&
            parsed.length === 2 &&
            (parsed[0] === 0 || parsed[0] === 1) &&
            Number.isFinite(parsed[1])
            ? value
            : null
        } catch {
          return null
        }
      })
      const boundary = parsedBoundary && {
        id: parsedBoundary.id,
        key: JSON.parse(parsedBoundary.key) as [number, number]
      }
      const remaining = boundary
        ? entries.filter((entry) => {
            const blocked = Number(!!entry.blockedOn)
            return (
              blocked < boundary.key[0] ||
              (blocked === boundary.key[0] &&
                (latestStart(entry) < boundary.key[1] ||
                  (latestStart(entry) === boundary.key[1] && entry.id.localeCompare(boundary.id) > 0)))
            )
          })
        : entries
      const items = remaining.slice(0, 50)
      const last = items.at(-1)
      return {
        items,
        totals,
        ...(remaining.length > 50 && last
          ? { nextCursor: encodeCursor(JSON.stringify([Number(!!last.blockedOn), latestStart(last)]), last.id) }
          : {})
      }
    }
    const ordering = keysetOrdering(table.endedAt, table.id, { major: 'desc', tie: 'desc' })
    const boundary = decodeListCursor(cursor, asNumericKey, 'agent-task-dashboard')
    const rows = this.db
      .select()
      .from(table)
      .where(and(awaiting(), boundary ? ordering.where(boundary) : undefined))
      .orderBy(...ordering.orderBy)
      .limit(51)
      .all()
    const items = rows.slice(0, 50).map((row) => ({ ...row, runIds: [row.id], runCount: 1 }))
    const last = items.at(-1)
    return { items, totals, ...(rows.length > 50 && last ? { nextCursor: encodeCursor(last.endedAt!, last.id) } : {}) }
  }
}

export const agentTaskRunService = new AgentTaskRunService()
