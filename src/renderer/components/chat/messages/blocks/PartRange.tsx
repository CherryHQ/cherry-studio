import React from 'react'

import type { Range } from '@renderer/utils/message/projectionRange'

import type { Runs } from './livePartRanges'

type Render<T> = (value: T, last: boolean) => React.ReactNode
function Cell<T>({ item, render, last }: { item: T; render: Render<T>; last: boolean }) {
  return render(item, last)
}
const PartCell = React.memo(Cell) as typeof Cell

type CellValue<T> = { key: string; item: T }
type Partition<T> = { key: string; cells: CellValue<T>[] } | { key: string; groups: CellRange<T>[] }
export type CellRange<T> = Range<T> | Partition<T>

function partition<T>(range: CellRange<T>): Partition<T> {
  if ('groups' in range || 'cells' in range) return range
  if (range.size > 32 && 'left' in range) return { key: range.key, groups: [range.left, range.right] }
  const cells: CellValue<T>[] = []
  function visit(node: Range<T>) {
    if ('item' in node) cells.push(node)
    else {
      visit(node.left)
      visit(node.right)
    }
  }
  visit(range)
  return { key: range.key, cells }
}

/** Keep each surviving cell's mounted parent as completed grouping combines or removes neighbors. */
export function reconcileResultCells<T>(
  previous: CellRange<unknown> | undefined,
  entries: readonly T[],
  getKey: (entry: T) => string
): Partition<T> | undefined {
  if (!entries.length) return
  const cells = entries.map((item) => ({ key: getKey(item), item }))
  if (!previous) return { key: cells[0].key, cells }
  const positions = new Map(cells.map((cell, index) => [cell.key, index]))
  let next = 0
  function replace(range: CellRange<unknown>, last: boolean): Partition<T> | undefined {
    const group = partition(range)
    if ('groups' in group) {
      const groups = group.groups.flatMap(
        (child, index) => replace(child, last && index === group.groups.length - 1) ?? []
      )
      return groups.length ? { key: group.key, groups } : undefined
    }
    const start = next
    for (const cell of group.cells) {
      const position = positions.get(cell.key)
      if (position !== undefined && position >= next) next = position + 1
    }
    if (last) next = cells.length
    return start < next ? { key: group.key, cells: cells.slice(start, next) } : undefined
  }
  return replace(previous, true)
}

function PartRangeView<T>({
  range,
  render,
  last = false
}: {
  range?: CellRange<T>
  render: Render<T>
  last?: boolean
}) {
  if (!range) return null
  const group = partition(range)
  if ('groups' in group)
    return group.groups.map((child, index) => (
      <PartRange key={child.key} range={child} render={render} last={last && index === group.groups.length - 1} />
    ))
  return group.cells.map(({ key, item }, index) => (
    <PartCell key={key} item={item} render={render} last={last && index === group.cells.length - 1} />
  ))
}
export const PartRange = React.memo(PartRangeView) as typeof PartRangeView

export function PartRuns<T extends { key: string }>({
  runs,
  render,
  last = false
}: {
  runs: Runs<T>
  render: Render<T>
  last?: boolean
}) {
  return (
    <>
      <React.Fragment key={runs.first.key}>{render(runs.first, last && !runs.last)}</React.Fragment>
      <PartRange range={runs.middle} render={render} />
      {runs.last && <React.Fragment key={runs.last.key}>{render(runs.last, last)}</React.Fragment>}
    </>
  )
}
