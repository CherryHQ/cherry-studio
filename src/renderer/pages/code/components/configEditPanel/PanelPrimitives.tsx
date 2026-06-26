import { Button, Label } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { FC, ReactNode } from 'react'

export const Section: FC<{ title: string; description?: string; action?: ReactNode; children: ReactNode }> = ({
  title,
  description,
  action,
  children
}) => (
  <section className="space-y-3">
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-foreground/70 text-xs">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {description && <p className="text-[11px] text-muted-foreground/50">{description}</p>}
    </div>
    {children}
  </section>
)

export const FormField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Label className="font-normal text-muted-foreground text-xs">{label}</Label>
    {children}
  </div>
)

/** "Advanced Settings" toggle (ghost button with a leading icon). */
export const AdvancedSettingsButton: FC<React.ComponentPropsWithoutRef<typeof Button>> = ({
  type = 'button',
  variant = 'ghost',
  size = 'sm',
  className,
  ...props
}) => (
  <Button
    type={type}
    variant={variant}
    size={size}
    className={cn('h-8 w-fit gap-1.5 px-2 text-primary hover:text-primary', className)}
    {...props}
  />
)

export const CollapsibleSection: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
}> = ({ open, onOpenChange, label, children }) => (
  <section className="space-y-2.5">
    <AdvancedSettingsButton onClick={() => onOpenChange(!open)}>
      <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
      {label}
    </AdvancedSettingsButton>
    {open && children}
  </section>
)
