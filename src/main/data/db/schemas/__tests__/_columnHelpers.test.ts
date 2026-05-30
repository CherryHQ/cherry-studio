import { getTableConfig, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { orderKeyColumns, orderKeyIndex, scopedOrderKeyIndex } from '../_columnHelpers'

// Build a minimal table using all order-key helpers so the produced
// indexes/columns can be asserted on via drizzle's getTableConfig.
const fixtureTable = sqliteTable(
  'fx_helper',
  {
    id: text().primaryKey(),
    // Scope column used by scopedOrderKeyIndex below.
    providerId: text('provider_id').notNull(),
    ...orderKeyColumns
  },
  (t) => [orderKeyIndex('fx_helper')(t), scopedOrderKeyIndex('fx_helper', 'providerId')(t)]
)

describe('_columnHelpers order key helpers', () => {
  describe('orderKeyColumns', () => {
    it('produces a NOT NULL text column named order_key under the `orderKey` property', () => {
      const { columns } = getTableConfig(fixtureTable)
      const col = columns.find((c) => c.name === 'order_key')
      expect(col).toBeDefined()
      expect(col!.notNull).toBe(true)
      expect(col!.dataType).toBe('string')
    })

    it('exposes the column under the TS property name `orderKey`', () => {
      // Spread locks the TS-level field name; `fixtureTable.orderKey` must be defined.
      expect(fixtureTable.orderKey).toBeDefined()
    })
  })

  describe('orderKeyIndex', () => {
    it('names the index `<table>_order_key_idx` and targets order_key', () => {
      const { indexes } = getTableConfig(fixtureTable)
      const idx = indexes.find((i) => i.config.name === 'fx_helper_order_key_idx')
      expect(idx).toBeDefined()
      const colNames = idx!.config.columns.map((c) => (c as { name: string }).name)
      expect(colNames).toEqual(['order_key'])
    })
  })

  describe('scopedOrderKeyIndex', () => {
    it('snake_cases the camelCase scope property only in the index NAME, and orders columns (scope, order_key)', () => {
      // Property in TS is `providerId`; index name uses snake_case `provider_id`.
      const { indexes } = getTableConfig(fixtureTable)
      const idx = indexes.find((i) => i.config.name === 'fx_helper_provider_id_order_key_idx')
      expect(idx).toBeDefined()
      const colNames = idx!.config.columns.map((c) => (c as { name: string }).name)
      // Column order matters: scope first, then order_key (for (scope, order_key) B-tree scans).
      expect(colNames).toEqual(['provider_id', 'order_key'])
    })

    it('produces a stable name for a different table/scope pair', () => {
      // Build an ad-hoc second table to confirm the naming pattern generalises.
      const otherTable = sqliteTable(
        'topic',
        {
          id: text().primaryKey(),
          groupId: text('group_id'),
          ...orderKeyColumns
        },
        (t) => [scopedOrderKeyIndex('topic', 'groupId')(t)]
      )
      const { indexes } = getTableConfig(otherTable)
      expect(indexes[0].config.name).toBe('topic_group_id_order_key_idx')
    })
  })
})
