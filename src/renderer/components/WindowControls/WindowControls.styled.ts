import { type ButtonHTMLAttributes, createElement, type HTMLAttributes } from 'react'

import { cn } from '@renderer/utils/style'

export const WindowControlsContainer = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) =>
  createElement('div', {
    ...props,
    className: cn('z-[9999] flex h-full min-h-0 items-stretch select-none [-webkit-app-region:no-drag]', className)
  })

export const ControlButton = ({
  $isClose,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { $isClose?: boolean }) =>
  createElement('button', {
    ...props,
    className: cn(
      'relative flex h-full w-[46px] cursor-pointer items-center justify-center rounded-none border-none bg-transparent p-0',
      'text-foreground transition-[background,color] duration-150 outline-none [&_svg]:pointer-events-none',
      $isClose
        ? 'hover:bg-[#e81123] hover:text-white active:bg-[#c50e1f] active:text-white'
        : 'hover:bg-[rgba(128,128,128,0.3)] hover:text-foreground active:bg-[rgba(128,128,128,0.4)] active:text-foreground',
      className
    )
  })
