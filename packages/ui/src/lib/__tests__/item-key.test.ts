import type { ComponentProps } from 'react'
import { expectTypeOf, it } from 'vitest'

import type { DataTableProps } from '../../components/composites/data-table'
import type Sortable from '../../components/composites/sortable/sortable'
import type { useDndReorder } from '../../hooks/use-dnd-reorder'

interface Item {
  id: string
  index: number
  bigId: bigint
  metadata: { id: string }
  enabled: boolean
  optionalId?: string
  nullableId: string | null
}

type InvalidField = 'metadata' | 'enabled' | 'optionalId' | 'nullableId'

it('restricts table field selectors to React keys', () => {
  type Selector = DataTableProps<Item>['rowKey']

  expectTypeOf<'id' | 'index' | 'bigId'>().toMatchTypeOf<Selector>()
  expectTypeOf<Extract<Selector, InvalidField>>().toBeNever()
  expectTypeOf<(item: Item) => bigint>().toMatchTypeOf<Selector>()
  expectTypeOf<(item: Item) => object>().not.toMatchTypeOf<Selector>()
})

it('restricts sortable field selectors to string or numeric IDs', () => {
  type Selector = ComponentProps<typeof Sortable<Item>>['itemKey']

  expectTypeOf<'id' | 'index'>().toMatchTypeOf<Selector>()
  expectTypeOf<Extract<Selector, InvalidField | 'bigId'>>().toBeNever()
  expectTypeOf<(item: Item) => string>().toMatchTypeOf<Selector>()
  expectTypeOf<(item: Item) => bigint>().not.toMatchTypeOf<Selector>()
})

it('preserves bigint identities in the filtered reorder hook', () => {
  type Options = Parameters<typeof useDndReorder<Item>>[0]
  type Selector = Options['itemKey']

  expectTypeOf<'id' | 'index' | 'bigId'>().toMatchTypeOf<Selector>()
  expectTypeOf<Extract<Selector, InvalidField>>().toBeNever()
  expectTypeOf<(item: Item) => bigint>().toMatchTypeOf<Selector>()
  expectTypeOf<(item: Item) => object>().not.toMatchTypeOf<Selector>()
})

it('accepts array indices and lengths without accepting array methods as IDs', () => {
  type Selector = DataTableProps<string[]>['rowKey']

  expectTypeOf<number | 'length'>().toMatchTypeOf<Selector>()
  expectTypeOf<Extract<Selector, 'map' | 'find'>>().toBeNever()
})
