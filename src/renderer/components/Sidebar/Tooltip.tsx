import { Tooltip } from '@cherrystudio/ui'
import React from 'react'

const sideToPlacement = {
  bottom: 'bottom',
  start: 'start',
  end: 'end',
  top: 'top'
} as const

export function SidebarTooltip({
  children,
  content,
  side = 'end'
}: {
  children: React.ReactNode
  content: string
  side?: 'end' | 'top' | 'bottom' | 'start'
}) {
  return (
    <Tooltip
      content={content}
      placement={sideToPlacement[side]}
      delay={400}
      classNames={{ content: 'text-[10px] leading-relaxed' }}>
      {children}
    </Tooltip>
  )
}
