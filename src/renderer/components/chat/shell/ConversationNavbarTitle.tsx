import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

interface ConversationNavbarTitleProps {
  title: string
  className?: string
}

export function ConversationNavbarTitle({ title, className }: ConversationNavbarTitleProps) {
  return (
    <div className={cn('ml-2 w-fit min-w-0 max-w-60 shrink', className)}>
      <Tooltip content={title} placement="bottom" delay={600} fullWidthTrigger>
        <span className="block truncate text-[13px] text-foreground" data-testid="conversation-navbar-title">
          {title}
        </span>
      </Tooltip>
    </div>
  )
}
