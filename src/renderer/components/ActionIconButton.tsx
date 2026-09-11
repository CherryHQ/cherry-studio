import React, { memo } from 'react'

import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

interface ActionIconButtonProps extends Omit<React.ComponentProps<typeof Button>, 'ref' | 'size' | 'variant'> {
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
        'flex cursor-pointer flex-row items-center justify-center rounded-full border-none p-0 text-base transition-all duration-300 ease-in-out [&_.icon]:text-muted-foreground [&_.icon-a-addchat]:mb-[-2px] [&_.icon-a-addchat]:text-lg [&_.iconfont]:text-muted-foreground [&_.lucide]:text-muted-foreground',
        active && '[&_.icon]:text-primary! [&_.iconfont]:text-primary! [&_.lucide]:text-primary!',
        className
      )}
      {...props}>
      {icon}
    </Button>
  )
}

ActionIconButton.displayName = 'ActionIconButton'

export default memo(ActionIconButton)
