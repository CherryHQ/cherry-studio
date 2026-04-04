import { cn } from '@renderer/utils'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import React, { memo } from 'react'

interface ActionIconButtonProps extends ButtonProps {
  children: React.ReactNode
  active?: boolean
}

/**
 * A simple action button rendered as an icon
 */
const ActionIconButton: React.FC<ActionIconButtonProps> = ({ children, active = false, className, ...props }) => {
  return (
    <Button
      type="text"
      shape="circle"
      className={cn(
        '[&_.icon-a-addchat]:-mb-0.5 flex h-7.5 w-7.5 cursor-pointer flex-row items-center justify-center border-none p-0 text-base transition-all duration-300 ease-in-out [&_.anticon]:text-icon [&_.icon-a-addchat]:text-lg [&_.icon]:text-icon [&_.iconfont]:text-icon [&_.lucide]:text-icon',
        active &&
          '[&_.anticon]:text-primary! [&_.icon]:text-primary! [&_.iconfont]:text-primary! [&_.lucide]:text-primary!',
        className
      )}
      {...props}>
      {children}
    </Button>
  )
}

export default memo(ActionIconButton)
