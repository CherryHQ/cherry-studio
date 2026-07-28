import { Tooltip } from '@cherrystudio/ui'
import React from 'react'

const sideToPlacement = {
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  top: 'top'
} as const

export function SidebarTooltip({
  children,
  content,
  side = 'right'
}: {
  children: React.ReactNode
  content: string
  side?: 'right' | 'top' | 'bottom' | 'left'
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
