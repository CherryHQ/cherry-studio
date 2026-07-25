import { cn } from '@cherrystudio/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react'
import * as React from 'react'

const alertVariants = cva(
  cn(
    'relative flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-sm leading-5 shadow-xs',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variants: {
      type: {
        info: 'border-info-border bg-info-subtle text-info-subtle-foreground',
        success: 'border-success-border bg-success-subtle text-success-subtle-foreground',
        warning: 'border-warning-border bg-warning-subtle text-warning-subtle-foreground',
        error: 'border-error-border bg-error-subtle text-error-subtle-foreground'
      }
    },
    defaultVariants: {
      type: 'info'
    }
  }
)

const alertIconVariants = cva('', {
  variants: {
    type: {
      info: 'text-info',
      success: 'text-success',
      warning: 'text-warning',
      error: 'text-error'
    }
  },
  defaultVariants: {
    type: 'info'
  }
})

const alertIconContainerVariants = cva('mt-0.5 flex shrink-0 items-center', {
  variants: {
    type: {
      info: 'text-info [&_.lucide:not(.lucide-custom)]:!text-info',
      success: 'text-success [&_.lucide:not(.lucide-custom)]:!text-success',
      warning: 'text-warning [&_.lucide:not(.lucide-custom)]:!text-warning',
      error: 'text-error [&_.lucide:not(.lucide-custom)]:!text-error'
    }
  },
  defaultVariants: {
    type: 'info'
  }
})

const alertIcons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: XCircle
} satisfies Record<NonNullable<AlertProps['type']>, React.ComponentType<{ className?: string; size?: number }>>

type AlertProps = Omit<React.ComponentProps<'div'>, 'title'> &
  VariantProps<typeof alertVariants> & {
    message?: React.ReactNode
    description?: React.ReactNode
    action?: React.ReactNode
    icon?: React.ReactNode
    showIcon?: boolean
  }

function Alert({
  className,
  type = 'info',
  message,
  description,
  action,
  icon,
  showIcon = false,
  children,
  role,
  ref,
  ...props
}: AlertProps) {
  const Icon = alertIcons[type ?? 'info']
  const alertRole = role ?? (type === 'error' ? 'alert' : 'status')

  return (
    <div
      ref={ref}
      role={alertRole}
      data-slot="alert"
      data-type={type}
      className={cn(alertVariants({ type }), className)}
      {...props}>
      {showIcon && (
        <span data-slot="alert-icon" data-type={type} className={alertIconContainerVariants({ type })}>
          {icon ?? <Icon size={16} className={cn('lucide-custom', alertIconVariants({ type }))} />}
        </span>
      )}
      <div data-slot="alert-content" className="min-w-0 flex-1">
        {children ?? (
          <>
            {message && (
              <div data-slot="alert-message" className="font-medium">
                {message}
              </div>
            )}
            {description && (
              <div data-slot="alert-description" className="mt-1 text-xs leading-5 opacity-90">
                {description}
              </div>
            )}
          </>
        )}
      </div>
      {action && (
        <div data-slot="alert-action" className="ml-2 flex shrink-0 items-center">
          {action}
        </div>
      )}
    </div>
  )
}

Alert.displayName = 'Alert'

export { Alert, alertVariants }
export type { AlertProps }
