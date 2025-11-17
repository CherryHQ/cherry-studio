import { Button, cn } from '@cherrystudio/ui'
import React, { memo } from 'react'

interface ActionIconButtonProps extends Omit<React.ComponentProps<'button'>, 'ref'> {
  icon: React.ReactNode
  active?: boolean
  loading?: boolean
}

/**
 * A simple action button rendered as an icon
 */
const ActionIconButton: React.FC<ActionIconButtonProps> = ({ icon, active = false, className, ...props }) => {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={cn(
        'flex cursor-pointer flex-row items-center justify-center rounded-full border-none p-0 text-base transition-all duration-300 ease-in-out [&_.anticon]:text-icon [&_.icon-a-addchat]:mb-[-2px] [&_.icon-a-addchat]:text-lg [&_.icon]:text-icon [&_.iconfont]:text-icon [&_.lucide]:text-icon',
        active &&
          '[&_.anticon]:text-primary! [&_.icon]:text-primary! [&_.iconfont]:text-primary! [&_.lucide]:text-primary!',
        className
      )}
      {...props}>
      {icon}
    </Button>
  )
}

ActionIconButton.displayName = 'ActionIconButton'

export default memo(ActionIconButton)
