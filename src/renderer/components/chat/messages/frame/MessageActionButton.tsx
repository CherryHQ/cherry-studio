import { ActionIconButton } from '@renderer/components/Buttons'
import { classNames } from '@renderer/utils'
import type { ComponentProps, ReactNode } from 'react'

type MessageActionButtonProps = Omit<ComponentProps<typeof ActionIconButton>, 'icon'> & {
  children?: ReactNode
  softHoverBg?: boolean
}

export const MessageActionButton = ({
  active,
  children,
  className,
  softHoverBg,
  type,
  ...props
}: MessageActionButtonProps) => {
  return (
    <ActionIconButton
      type={type ?? 'button'}
      active={active}
      icon={children}
      className={classNames(
        'flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-1.5 text-foreground/70! transition-all duration-150 ease-out',
        '[&_.anticon]:text-current! [&_.icon-at]:text-[9px] [&_.icon]:text-current! [&_.iconfont]:text-[9px] [&_.iconfont]:text-current! [&_.lucide]:text-current! [&_svg]:size-2',
        'enabled:cursor-pointer enabled:hover:text-foreground!',
        'enabled:[&_.iconfont]:cursor-pointer enabled:[&_svg]:cursor-pointer',
        softHoverBg ? 'enabled:hover:bg-muted' : 'enabled:hover:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active && 'text-primary!',
        className
      )}
      {...props}
    />
  )
}
