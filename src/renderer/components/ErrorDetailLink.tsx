import { ChevronRight } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

/** The quiet 「详情 ›」 link every error surface uses to open the error detail modal. */
export function ErrorDetailLink({
  className,
  expanded,
  label,
  onClick
}: {
  readonly className?: string
  /** Set when the link toggles detail in place instead of opening the modal. */
  readonly expanded?: boolean
  readonly label?: ReactNode
  readonly onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      aria-expanded={expanded}
      className={cn(
        'h-auto min-h-0 cursor-pointer gap-0.5 rounded-sm px-0 text-foreground-tertiary shadow-none dark:text-foreground-tertiary',
        'hover:text-foreground hover:no-underline focus-visible:text-foreground group-hover:text-foreground dark:hover:text-foreground dark:focus-visible:text-foreground',
        className
      )}
      onClick={onClick}>
      {label ?? t('common.detail')}
      <ChevronRight className="size-3.5" aria-hidden />
    </Button>
  )
}
