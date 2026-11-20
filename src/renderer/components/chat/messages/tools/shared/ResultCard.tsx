import { ArrowRight } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'

import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

type ResultCardProps = Omit<ComponentProps<'div'>, 'title' | 'onClick'> & {
  media: ReactNode
  title: string
  /** What the result is, e.g. "Agent", next to the title. */
  tag?: string
  badge?: ReactNode
  description?: ReactNode
  /** One quiet line of facts under the description. */
  meta?: string
  /** Runs from a click anywhere on the card, and from the round arrow that is its keyboard path. */
  primary?: { label: string; onClick: () => void }
  /** Secondary controls; while the card has a primary action they show on hover or keyboard focus. */
  actions?: ReactNode
  /** Shown under the row, e.g. an expanded list. */
  children?: ReactNode
}

const stop = (event: MouseEvent) => event.stopPropagation()

/** A result a tool leaves in the conversation: what it is, and one obvious way into it. */
export function ResultCard({
  media,
  title,
  tag,
  badge,
  description,
  meta,
  primary,
  actions,
  children,
  className,
  ...props
}: ResultCardProps) {
  // A drag that selects text ends in a click too; copying from the card must not leave the conversation.
  const handleCardClick = primary
    ? () => {
        if (window.getSelection()?.isCollapsed === false) return
        primary.onClick()
      }
    : undefined

  return (
    <Item
      variant="outline"
      size="sm"
      onClick={handleCardClick}
      className={cn(
        'group/result my-1 w-full max-w-[520px] gap-x-3 gap-y-2 rounded-xl bg-card px-3.5 py-3 transition-colors',
        primary &&
          'cursor-pointer hover:border-border-strong hover:bg-accent/50 has-[[data-result-primary]:focus-visible]:bg-accent/50 has-[[data-result-primary]:focus-visible]:ring-2 has-[[data-result-primary]:focus-visible]:ring-ring has-[[data-result-primary]:focus-visible]:ring-inset',
        className
      )}
      {...props}>
      <ItemMedia>{media}</ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0 gap-1.5 leading-5">
          <span className="truncate" title={title}>
            {title}
          </span>
          {tag ? <span className="shrink-0 font-normal text-foreground-tertiary text-xs">{tag}</span> : null}
          {badge}
        </ItemTitle>
        {description ? (
          <ItemDescription className="line-clamp-1 text-wrap text-[13px] leading-5">{description}</ItemDescription>
        ) : null}
        {meta ? (
          <div className="truncate text-foreground-tertiary text-xs leading-4" title={meta}>
            {meta}
          </div>
        ) : null}
      </ItemContent>
      <ItemActions className="gap-1" onClick={stop}>
        {actions ? (
          <div
            className={cn(
              'flex items-center gap-1',
              primary &&
                'opacity-0 transition-opacity group-focus-within/result:opacity-100 group-hover/result:opacity-100'
            )}>
            {actions}
          </div>
        ) : null}
        {primary ? (
          <Tooltip content={primary.label}>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              data-result-primary
              aria-label={primary.label}
              onClick={primary.onClick}
              className="size-8 rounded-full transition-colors focus-visible:bg-foreground focus-visible:text-background group-hover/result:bg-foreground group-hover/result:text-background">
              <ArrowRight className="size-4 transition-transform group-hover/result:translate-x-0.5 motion-reduce:transition-none" />
            </Button>
          </Tooltip>
        ) : null}
      </ItemActions>
      {children ? (
        <div className="w-full" onClick={stop}>
          {children}
        </div>
      ) : null}
    </Item>
  )
}
