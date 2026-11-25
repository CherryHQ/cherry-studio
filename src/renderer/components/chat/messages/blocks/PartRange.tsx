import React from 'react'

import type { Range } from '@renderer/utils/message/projectionRange'

import type { Runs } from './livePartRanges'

type Render<T> = (value: T, last: boolean) => React.ReactNode
function Cell<T>({ item, render, last }: { item: T; render: Render<T>; last: boolean }) {
  return render(item, last)
}
const PartCell = React.memo(Cell) as typeof Cell

function PartRangeView<T>({ range, render, last = false }: { range?: Range<T>; render: Render<T>; last?: boolean }) {
  if (!range) return null
  if (range.size <= 32) {
    const cells: React.ReactNode[] = []
    function visit(node: Range<T>, atEnd: boolean) {
      if ('item' in node) cells.push(<PartCell key={node.key} item={node.item} render={render} last={atEnd} />)
      else {
        visit(node.left, false)
        visit(node.right, atEnd)
      }
    }
    visit(range, last)
    return cells
  }
  if ('item' in range) return render(range.item, last)
  return (
    <>
      <PartRange key={range.left.key} range={range.left} render={render} />
      <PartRange key={range.right.key} range={range.right} render={render} last={last} />
    </>
  )
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
