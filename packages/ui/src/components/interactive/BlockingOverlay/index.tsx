import { cn } from '@heroui/react'
import type { ReactNode } from 'react'
import React, { useCallback } from 'react'

// 定义组件的 props 类型
interface BlockingOverlayProps {
  isVisible: boolean
  onClick?: () => void
  children?: ReactNode
  className?: string
}

export const BlockingOverlay = ({ isVisible, onClick, children, className }: BlockingOverlayProps) => {
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      if (onClick) {
        onClick()
      }
    },
    [onClick]
  )

  if (!isVisible) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute inset-0',
        'bg-black/50',
        'z-[9999]',
        'flex items-center justify-center',
        'pointer-events-auto',
        className
      )}
      onClick={handleClick}>
      {children}
    </div>
  )
}
