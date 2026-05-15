import type { ReactNode } from 'react'

import { ToolDisclosure, type ToolDisclosureItem } from '../shared/ToolDisclosure'
import { StreamingContext } from './GenericTools'

export function AgentToolDisclosureLabel({
  label,
  trailing,
  labelClassName,
  trailingClassName
}: {
  label: ReactNode
  trailing?: ReactNode
  labelClassName?: string
  trailingClassName?: string
}) {
  return (
    <div className="flex w-full items-start justify-between gap-2">
      <div className={labelClassName ?? 'min-w-0'}>{label}</div>
      {trailing && <div className={trailingClassName ?? 'shrink-0'}>{trailing}</div>}
    </div>
  )
}

export function AgentToolDisclosure({
  className,
  defaultActiveKey = [],
  isStreaming = false,
  item
}: {
  className?: string
  defaultActiveKey?: string[]
  isStreaming?: boolean
  item: ToolDisclosureItem
}) {
  return (
    <StreamingContext value={isStreaming}>
      <ToolDisclosure className={className} defaultActiveKey={defaultActiveKey} items={[item]} />
    </StreamingContext>
  )
}
