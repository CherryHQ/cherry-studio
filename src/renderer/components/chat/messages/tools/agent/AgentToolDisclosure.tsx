import { cn } from '@renderer/utils'
import { ChevronDown } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'

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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className={labelClassName ?? 'min-w-0 flex-1'}>{label}</div>
      {trailing && <div className={trailingClassName ?? 'shrink-0'}>{trailing}</div>}
    </div>
  )
}

export function AgentToolDisclosure({
  className,
  defaultActiveKey = [],
  isStreaming = false,
  item,
  onOpenDetails,
  showInlineDetails = true
}: {
  className?: string
  defaultActiveKey?: string[]
  isStreaming?: boolean
  item: ToolDisclosureItem
  onOpenDetails?: () => void
  showInlineDetails?: boolean
}) {
  const contentId = useId()
  const itemKey = String(item.key)
  const canExpand = showInlineDetails && item.children !== undefined && item.children !== null
  const isInteractive = canExpand || !!onOpenDetails
  const [isExpanded, setIsExpanded] = useState(() => defaultActiveKey.includes(itemKey))
  const toggleExpanded = () => {
    if (!canExpand) return
    setIsExpanded((expanded) => !expanded)
  }
  const openOrToggle = () => {
    if (onOpenDetails) {
      onOpenDetails()
      return
    }
    toggleExpanded()
  }
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openOrToggle()
  }

  return (
    <StreamingContext value={isStreaming}>
      <div
        className={cn(
          'w-full overflow-hidden rounded-[7px] border border-border bg-background',
          className,
          item.classNames?.item,
          item.className
        )}>
        <div
          role={isInteractive ? 'button' : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          aria-expanded={canExpand ? isExpanded : undefined}
          aria-controls={canExpand ? contentId : undefined}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left font-semibold text-foreground/90 text-sm leading-4 outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
            item.classNames?.header
          )}
          onClick={isInteractive ? openOrToggle : undefined}
          onKeyDown={handleHeaderKeyDown}>
          {item.label}
          {canExpand && (
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={cn(
                'ml-auto shrink-0 text-foreground-muted opacity-70 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
        {canExpand && (
          <div
            id={contentId}
            data-testid={`collapse-content-${item.key}`}
            hidden={!isExpanded}
            className={cn(
              'mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground-secondary leading-5',
              item.classNames?.body
            )}>
            {item.children}
          </div>
        )}
      </div>
    </StreamingContext>
  )
}
