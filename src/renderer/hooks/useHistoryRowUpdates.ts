import { useCallback, useEffect, useMemo, useState } from 'react'

import { loggerService } from '@logger'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type { Message } from '@shared/data/types/message'

import { historyPageLayout, keepHistoryPageLayout } from './historyPageLayout'

const logger = loggerService.withContext('historyRows')

type Row = Pick<Message, 'id' | 'status'>
export type HistorySlot = { page: number; item: number; sibling?: number }
type HistoryRead = 'written' | 'pending'
type Read = { newer?: Promise<HistoryRead> }
const pageReads = new WeakMap<object, Map<string, Read>>()

type PrependPages<Page> = (
  ids: ReadonlySet<string>,
  canCommit: (pages: Page[]) => boolean
) => Promise<Page[] | undefined>

type Membership = { kind: 'row'; row: Row } | { kind: 'excluded' | 'unknown' }

export interface ReplyHistory {
  /** Changes on a new branch page, while addressed writes retain their layout. */
  layout?: object
  lookup(id: string): Membership
  refreshRow(id: string): Promise<HistoryRead>
}

export interface PageRows<Item, Entity extends Row> {
  get(items: Item[], slot: HistorySlot): Entity | undefined
  replace(items: Item[], slot: HistorySlot, row: Entity): Item[]
}

export function useHistoryRowUpdates<
  Item,
  Entity extends Row,
  Page extends { items: Item[]; nextCursor?: string | null }
>(
  pages: Page[],
  positions: ReadonlyMap<string, HistorySlot>,
  rows: PageRows<Item, Entity>,
  read: (id: string) => Promise<Entity>,
  write: (pageIndex: number, update: (page: Page) => Item[]) => Promise<void>,
  scope: string,
  refresh: (options: { throwOnError: true }) => Promise<Page[] | undefined>,
  excludedSiblings: ReadonlySet<string>,
  prependPages?: PrependPages<Page>
) {
  const request = useMemo(
    (): {
      scope: string
      pending?: { ids: Set<string>; promise: Promise<void>; append: boolean }
      failed: boolean
    } => ({ scope, failed: false }),
    [scope]
  )
  useEffect(
    () => () => {
      request.pending = undefined
    },
    [request]
  )
  const [coverage, setCoverage] = useState<{ owner: typeof request; ids: Set<string>; first: object; last: object }>()
  const verifyMembership = useCallback(
    (ids: readonly string[], { invalidate = false, append = false } = {}) => {
      const current = request.pending
      const tryAppend = !!prependPages && append && (!current || current.append)
      if (current && (!invalidate || tryAppend) && ids.every((id) => current.ids.has(id))) return current.promise
      const expected = new Set([...(current?.ids ?? []), ...ids])
      setCoverage(undefined)
      const isCurrent = () => request.pending?.promise === promise
      const load = async () => {
        if (!isCurrent()) return
        if (tryAppend) {
          const updated = await prependPages(
            expected,
            (pages) => isCurrent() && !pages.some(({ items }) => pageReads.get(historyPageLayout(items))?.size)
          )
          if (updated || !isCurrent()) return updated
        }
        return refresh({ throwOnError: true })
      }
      const promise: Promise<void> = Promise.resolve()
        .then(load)
        .then((pages) => {
          if (request.pending?.promise !== promise || !pages?.length) return
          request.failed = false
          setCoverage({
            owner: request,
            ids: expected,
            first: historyPageLayout(pages[0].items),
            last: historyPageLayout(pages[pages.length - 1].items)
          })
        })
        .catch((error) => {
          if (request.pending?.promise === promise) request.failed = true
          throw error
        })
        .finally(() => {
          if (request.pending?.promise === promise) request.pending = undefined
        })
      request.pending = { ids: expected, promise, append: tryAppend }
      return promise
    },
    [request, refresh, prependPages]
  )
  const covered =
    coverage?.owner === request &&
    pages.length > 0 &&
    historyPageLayout(pages[0].items) === coverage.first &&
    historyPageLayout(pages[pages.length - 1].items) === coverage.last
  const complete = covered && !pages[pages.length - 1].nextCursor
  const has = useMemo(() => (id: string) => positions.has(id), [positions])
  const updates = useMemo(() => {
    const get = (id: string) => {
      const position = positions.get(id)
      return position && pages[position.page] && rows.get(pages[position.page].items, position)
    }
    const refreshRow = (id: string): Promise<HistoryRead> => {
      const position = positions.get(id)
      if (!position || !pages[position.page]) return Promise.resolve('pending')
      const { page } = position
      const before = rows.get(pages[page].items, position)
      if (before?.id !== id) return Promise.resolve('pending')
      const layout = historyPageLayout(pages[page].items)
      let requests = pageReads.get(layout)
      if (!requests) {
        requests = new Map()
        pageReads.set(layout, requests)
      }
      const ticket: Read = {}
      const previous = requests.get(id)
      requests.set(id, ticket)
      const request = read(id)
        .then(async (row) => {
          if (ticket.newer) return ticket.newer
          if (row.id !== id) throw new Error('History row identity changed')
          let applied = false
          await write(page, ({ items }) => {
            if (ticket.newer) return items
            if (historyPageLayout(items) !== layout && rows.get(items, position) !== before) return items
            const updated = rows.replace(items, position, row)
            applied = true
            keepHistoryPageLayout(items, updated)
            return updated
          })
          return ticket.newer ?? (applied && row.status !== 'pending' ? ('written' as const) : ('pending' as const))
        })
        .finally(() => {
          if (requests.get(id) === ticket) requests.delete(id)
        })
      if (previous) previous.newer = request
      return request
    }
    return { get, refreshRow }
  }, [positions, pages, read, rows, write])
  const replyHistory = useMemo<ReplyHistory>(
    () => ({
      layout: pages.length ? positions : undefined,
      lookup(id) {
        const row = updates.get(id)
        if (row && !excludedSiblings.has(id)) return { kind: 'row', row }
        if (covered && coverage?.ids.has(id) && (complete || excludedSiblings.has(id))) return { kind: 'excluded' }
        return { kind: 'unknown' }
      },
      refreshRow(id) {
        return has(id) && !excludedSiblings.has(id)
          ? updates.refreshRow(id)
          : verifyMembership([id]).then(() => 'pending')
      }
    }),
    [updates, pages.length, positions, covered, coverage, excludedSiblings, complete, has, verifyMembership]
  )
  const onChange = (effects: readonly DataApiDataChangeEffect[]) => {
    if (effects.some((effect) => effect.kind !== 'projection' || !effect.entityIds)) {
      void verifyMembership(
        effects.flatMap((effect) => effect.entityIds ?? []),
        {
          invalidate: true,
          append: effects.every((effect) => effect.kind === 'membership' && !!effect.entityIds?.length)
        }
      ).catch((error) => logger.warn('Could not refresh history membership', { error }))
      return
    }
    const missing: string[] = []
    for (const id of new Set(effects.flatMap((effect) => effect.entityIds ?? []))) {
      if (!has(id)) {
        missing.push(id)
        continue
      }
      void updates.refreshRow(id).catch((error) => logger.warn('Could not update changed history row', { id, error }))
    }
    if (missing.length && request.failed)
      void verifyMembership(missing).catch((error) => logger.warn('Could not refresh history membership', { error }))
  }
  return { replyHistory, onChange, refreshMembership: verifyMembership }
}
