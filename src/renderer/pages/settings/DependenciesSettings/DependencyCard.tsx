import { cn } from '@renderer/utils/style'
import type { FC, ReactNode } from 'react'

interface DependencyCardProps {
  icon: ReactNode
  available: boolean
  title: ReactNode
  titleAccessory?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

/** Shared settings card for downloadable models and managed binary dependencies. */
const DependencyCard: FC<DependencyCardProps> = ({
  icon,
  available,
  title,
  titleAccessory,
  subtitle,
  badges,
  actions,
  children
}) => (
  <div
    role="listitem"
    data-slot="dependency-card"
    className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-200 ease-in-out hover:border-border-strong">
    <div className="flex items-start gap-3">
      <div
        data-slot="dependency-card-icon"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl [&_.lucide:not(.lucide-custom)]:text-current!',
          available ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-muted text-muted-foreground'
        )}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div data-slot="dependency-card-title" className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium text-foreground text-sm leading-5">{title}</span>
              {titleAccessory}
            </div>
            {subtitle && (
              <div
                data-slot="dependency-card-subtitle"
                className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-4">
                {subtitle}
              </div>
            )}
            {badges && (
              <div data-slot="dependency-card-badges" className="mt-1 flex flex-wrap items-center gap-1">
                {badges}
              </div>
            )}
          </div>
          {actions && (
            <div data-slot="dependency-card-actions" className="flex shrink-0 items-center gap-1">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
    {children}
  </div>
)

export default DependencyCard
