import type React from 'react'
import { memo, useCallback, useMemo } from 'react'

import DynamicVirtualList, { type DynamicVirtualListProps } from './dynamic'

export type GroupedVirtualListGroup<TGroup, TItem, THeader = TGroup, TFooter = unknown> = {
  group: TGroup
  header?: THeader
  items: readonly TItem[]
  footer?: TFooter
}

export type GroupedVirtualListRow<TGroup, TItem, THeader = TGroup, TFooter = unknown> =
  | {
      type: 'group-header'
      group: TGroup
      groupIndex: number
      header: THeader
    }
  | {
      type: 'item'
      group: TGroup
      groupIndex: number
      item: TItem
      itemIndex: number
      itemIndexInGroup: number
    }
  | {
      type: 'group-footer'
      group: TGroup
      groupIndex: number
      footer: TFooter
    }

type BaseDynamicVirtualListProps<TGroup, TItem, THeader, TFooter> = Omit<
  DynamicVirtualListProps<GroupedVirtualListRow<TGroup, TItem, THeader, TFooter>>,
  'children' | 'estimateSize' | 'list'
>

export interface GroupedVirtualListProps<TGroup, TItem, THeader = TGroup, TFooter = unknown>
  extends BaseDynamicVirtualListProps<TGroup, TItem, THeader, TFooter> {
  groups: readonly GroupedVirtualListGroup<TGroup, TItem, THeader, TFooter>[]
  renderGroupHeader?: (header: THeader, group: TGroup, groupIndex: number) => React.ReactNode
  renderItem: (
    item: TItem,
    itemIndex: number,
    group: TGroup,
    groupIndex: number,
    itemIndexInGroup: number
  ) => React.ReactNode
  renderGroupFooter?: (footer: TFooter, group: TGroup, groupIndex: number) => React.ReactNode
  estimateGroupHeaderSize?: (header: THeader, group: TGroup, groupIndex: number) => number
  estimateItemSize: (
    item: TItem,
    itemIndex: number,
    group: TGroup,
    groupIndex: number,
    itemIndexInGroup: number
  ) => number
  estimateGroupFooterSize?: (footer: TFooter, group: TGroup, groupIndex: number) => number
}

const DEFAULT_GROUP_HEADER_SIZE = 32
const DEFAULT_GROUP_FOOTER_SIZE = 32

export function buildGroupedVirtualRows<TGroup, TItem, THeader, TFooter>(
  groups: readonly GroupedVirtualListGroup<TGroup, TItem, THeader, TFooter>[],
  hasGroupHeader: boolean,
  hasGroupFooter: boolean
) {
  const rows: GroupedVirtualListRow<TGroup, TItem, THeader, TFooter>[] = []
  let itemIndex = 0

  groups.forEach((entry, groupIndex) => {
    if (hasGroupHeader && entry.header !== undefined) {
      rows.push({
        type: 'group-header',
        group: entry.group,
        groupIndex,
        header: entry.header
      })
    }

    entry.items.forEach((item, itemIndexInGroup) => {
      rows.push({
        type: 'item',
        group: entry.group,
        groupIndex,
        item,
        itemIndex,
        itemIndexInGroup
      })
      itemIndex += 1
    })

    if (hasGroupFooter && entry.footer !== undefined) {
      rows.push({
        type: 'group-footer',
        group: entry.group,
        groupIndex,
        footer: entry.footer
      })
    }
  })

  return rows
}

function GroupedVirtualList<TGroup, TItem, THeader = TGroup, TFooter = unknown>(
  props: GroupedVirtualListProps<TGroup, TItem, THeader, TFooter>
) {
  const {
    groups,
    renderGroupHeader,
    renderItem,
    renderGroupFooter,
    estimateGroupHeaderSize,
    estimateItemSize,
    estimateGroupFooterSize,
    ...virtualListProps
  } = props

  const rows = useMemo(
    () => buildGroupedVirtualRows(groups, Boolean(renderGroupHeader), Boolean(renderGroupFooter)),
    [groups, renderGroupFooter, renderGroupHeader]
  )

  const estimateRowSize = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return 0

      if (row.type === 'group-header') {
        return estimateGroupHeaderSize?.(row.header, row.group, row.groupIndex) ?? DEFAULT_GROUP_HEADER_SIZE
      }

      if (row.type === 'group-footer') {
        return estimateGroupFooterSize?.(row.footer, row.group, row.groupIndex) ?? DEFAULT_GROUP_FOOTER_SIZE
      }

      return estimateItemSize(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
    },
    [estimateGroupFooterSize, estimateGroupHeaderSize, estimateItemSize, rows]
  )

  const renderRow = useCallback(
    (row: GroupedVirtualListRow<TGroup, TItem, THeader, TFooter>) => {
      if (row.type === 'group-header') {
        return renderGroupHeader?.(row.header, row.group, row.groupIndex) ?? null
      }

      if (row.type === 'group-footer') {
        return renderGroupFooter?.(row.footer, row.group, row.groupIndex) ?? null
      }

      return renderItem(row.item, row.itemIndex, row.group, row.groupIndex, row.itemIndexInGroup)
    },
    [renderGroupFooter, renderGroupHeader, renderItem]
  )

  return <DynamicVirtualList {...virtualListProps} list={rows} estimateSize={estimateRowSize} children={renderRow} />
}

const MemoizedGroupedVirtualList = memo(GroupedVirtualList) as <TGroup, TItem, THeader = TGroup, TFooter = unknown>(
  props: GroupedVirtualListProps<TGroup, TItem, THeader, TFooter>
) => React.ReactElement

export default MemoizedGroupedVirtualList
