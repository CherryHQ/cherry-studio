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
        'flex size-5.5 items-center justify-center rounded-md border-0 bg-transparent p-0 text-(--color-icon) transition-all duration-150 ease-out',
        '[&_.icon-at]:text-sm [&_.iconfont]:text-[13px] [&_svg]:size-3.5',
        'enabled:cursor-pointer enabled:hover:text-foreground',
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
