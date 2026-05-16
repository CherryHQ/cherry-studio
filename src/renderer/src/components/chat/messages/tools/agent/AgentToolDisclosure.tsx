import { cn } from '@renderer/utils'
import { Minus, Plus } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
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
    <div className="flex w-full items-center gap-2">
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
  const contentId = useId()
  const itemKey = String(item.key)
  const [isExpanded, setIsExpanded] = useState(() => defaultActiveKey.includes(itemKey))

  return (
    <StreamingContext value={isStreaming}>
      <div
        className={cn(
          'w-full overflow-hidden rounded-[7px] border border-border bg-background',
          className,
          item.classNames?.item,
          item.className
        )}>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className={cn(
            'group/agent-tool-trigger relative flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-left font-semibold text-foreground/90 text-sm leading-4 outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 hover:[&_.tool-icon>*]:opacity-0',
            item.classNames?.header
          )}
          onClick={() => setIsExpanded((expanded) => !expanded)}>
          {item.label}
          {isExpanded ? (
            <Minus
              size={16}
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 shrink-0 text-foreground-muted opacity-0 group-hover/agent-tool-trigger:opacity-100"
              style={{ left: 'var(--agent-tool-toggle-left, 0.625rem)' }}
            />
          ) : (
            <Plus
              size={16}
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 shrink-0 text-foreground-muted opacity-0 group-hover/agent-tool-trigger:opacity-100"
              style={{ left: 'var(--agent-tool-toggle-left, 0.625rem)' }}
            />
          )}
        </button>
        <div
          id={contentId}
          data-testid={`collapse-content-${item.key}`}
          hidden={!isExpanded}
          className={cn('mt-2 p-2.5 text-foreground/60 text-sm leading-5', item.classNames?.body)}>
          {item.children}
        </div>
      </div>
    </StreamingContext>
  )
}
