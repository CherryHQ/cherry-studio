import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'

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
