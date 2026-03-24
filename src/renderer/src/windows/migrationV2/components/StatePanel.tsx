import { cn } from '@cherrystudio/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'

type Props = {
  title: string
  description?: string
  icon: LucideIcon
  tone?: 'primary' | 'danger'
  loading?: boolean
  mono?: boolean
}

export function StatePanel({ title, description, icon: Icon, tone = 'primary', loading = false, mono = false }: Props) {
  return (
    <div className="flex items-start gap-4 py-2 text-left">
      <Icon
        className={cn(
          'lucide-custom mt-0.5 size-5 shrink-0',
          tone === 'primary' && 'text-primary',
          tone === 'danger' && 'text-red-700',
          loading && 'animate-spin'
        )}
      />
      <div className="min-w-0">
        <p className={cn('font-medium text-sm', tone === 'danger' ? 'text-red-800' : 'text-foreground')}>{title}</p>
        {description ? (
          <p
            className={cn(
              'mt-1 text-sm leading-6',
              tone === 'danger' ? 'text-red-700' : 'text-muted-foreground',
              mono && 'font-mono'
            )}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}
