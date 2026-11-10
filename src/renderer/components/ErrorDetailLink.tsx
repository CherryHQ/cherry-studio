import { ChevronRight } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@cherrystudio/ui/lib/utils'

/** The quiet 「详情 ›」 link every error surface uses to open the error detail modal. */
export function ErrorDetailLink({
  className,
  label,
  onClick
}: {
  readonly className?: string
  readonly label?: ReactNode
  readonly onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-sm text-xs text-foreground-tertiary outline-none transition-colors',
        'hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:text-foreground',
        className
      )}
      onClick={onClick}>
      {label ?? t('common.detail')}
      <ChevronRight size={14} aria-hidden />
    </button>
  )
}
