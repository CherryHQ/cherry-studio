import type { ColumnApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import type { FC } from 'react'

import { resolveChildRefs } from '../lib/child-refs'
import { cn } from '../lib/cn'
import type { BuildChild, UarComponentProps } from '../react/types'

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  spaceBetween: 'justify-between',
  spaceAround: 'justify-around',
  spaceEvenly: 'justify-evenly',
  stretch: 'justify-stretch'
}

const ALIGN: Record<string, string> = {
  center: 'items-center',
  end: 'items-end',
  start: 'items-start',
  stretch: 'items-stretch'
}

type ColumnProps = UarComponentProps<typeof ColumnApi>

/** `Column` — vertical layout primitive. Renders `children` via `buildChild`. */
export const UarColumn: FC<{ props: ColumnProps; buildChild: BuildChild }> = ({ props, buildChild }) => {
  const children = resolveChildRefs(props.children)
  return (
    <div
      data-a2ui-component="Column"
      className={cn('flex flex-col gap-2', JUSTIFY[props.justify ?? 'start'], ALIGN[props.align ?? 'stretch'])}>
      {children.map((child) => (
        <div
          className="min-w-0 max-w-full"
          key={child.id}
          style={props.weight ? { flexGrow: props.weight } : undefined}>
          {buildChild(child.id, child.basePath)}
        </div>
      ))}
    </div>
  )
}
