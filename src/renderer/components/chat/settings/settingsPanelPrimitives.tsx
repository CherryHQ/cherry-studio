import { Switch, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { SettingRow as BaseSettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { Info } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const SettingRowTitleSmall = ({
  className,
  children,
  hint,
  ...rest
}: ComponentPropsWithoutRef<typeof SettingRowTitle> & { hint?: string }) => (
  <SettingRowTitle
    className={cn('text-(length:--font-size-body-xs) min-w-0 gap-1.5 text-foreground leading-4.5', className)}
    {...rest}>
    <span className="min-w-0 truncate">{children}</span>
    {hint && (
      <Tooltip content={hint} placement="top" className="w-fit max-w-sm px-2.5 py-1.5 text-xs leading-relaxed">
        <Info size={12} className="shrink-0 cursor-help text-muted-foreground" />
      </Tooltip>
    )}
  </SettingRowTitle>
)

export const SettingSwitch = ({
  label,
  hint,
  size,
  'aria-label': ariaLabel,
  ...props
}: ComponentPropsWithoutRef<typeof Switch> & { label: ReactNode; hint?: string }) => (
  <>
    <SettingRowTitleSmall hint={hint}>{label}</SettingRowTitleSmall>
    <Switch size={size} aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)} {...props} />
  </>
)

export const SettingRow = ({ className, ...rest }: ComponentPropsWithoutRef<typeof BaseSettingRow>) => (
  <BaseSettingRow className={cn('min-h-8 gap-3', className)} {...rest} />
)
