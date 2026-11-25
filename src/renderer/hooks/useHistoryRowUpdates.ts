import { useMemo } from 'react'

import { loggerService } from '@logger'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type { Message } from '@shared/data/types/message'

import { historyPageLayout, keepHistoryPageLayout } from './historyPageLayout'

const logger = loggerService.withContext('historyRows')

type Row = Pick<Message, 'id' | 'status'>
export type HistorySlot = { page: number; item: number; sibling?: number }
type Read = { newer?: Promise<void> }
const pageReads = new WeakMap<object, Map<string, Read>>()

export interface ReplyHistory {
  loaded: boolean
  has(id: string): boolean
  get(id: string): Row | undefined
  refreshRow(id: string): Promise<void>
}

export interface PageRows<Item, Entity extends Row> {
  get(items: Item[], slot: HistorySlot): Entity | undefined
  replace(items: Item[], slot: HistorySlot, row: Entity): Item[]
}

export function useHistoryRowUpdates<Item, Entity extends Row, Page extends { items: Item[] }>(
  pages: Page[],
  positions: ReadonlyMap<string, HistorySlot>,
  rows: PageRows<Item, Entity>,
  read: (id: string) => Promise<Entity>,
  write: (pageIndex: number, update: (page: Page) => Item[]) => Promise<void>
): ReplyHistory {
  const has = useMemo(() => (id: string) => positions.has(id), [positions])
  return useMemo(() => {
    const get = (id: string) => {
      const position = positions.get(id)
      return position && pages[position.page] && rows.get(pages[position.page].items, position)
    }
    const refreshRow = (id: string): Promise<void> => {
      const position = positions.get(id)
      if (!position || !pages[position.page]) return Promise.resolve()
      const { page } = position
      const before = rows.get(pages[page].items, position)
      if (before?.id !== id) return Promise.resolve()
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
          await write(page, ({ items }) => {
            if (ticket.newer) return items
            if (historyPageLayout(items) !== layout && rows.get(items, position) !== before) return items
            const updated = rows.replace(items, position, row)
            keepHistoryPageLayout(items, updated)
            return updated
          })
          return ticket.newer
        })
        .finally(() => {
          if (requests.get(id) === ticket) requests.delete(id)
        })
      if (previous) previous.newer = request
      return request
    }
    return { loaded: pages.length > 0, has, get, refreshRow }
  }, [has, positions, pages, read, rows, write])
}

export function applyHistoryChanges(
  effects: readonly DataApiDataChangeEffect[],
  history: ReplyHistory,
  refreshMembership: () => Promise<unknown>
): void {
  if (effects.some((effect) => effect.kind !== 'projection' || !effect.entityIds)) {
    void refreshMembership()
    return
  }
  for (const id of new Set(effects.flatMap((effect) => effect.entityIds ?? []))) {
    void history.refreshRow(id).catch((error) => logger.warn('Could not update changed history row', { id, error }))
  }
}
