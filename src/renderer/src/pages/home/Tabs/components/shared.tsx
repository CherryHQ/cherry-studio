import { cn } from '@heroui/react'
import { ComponentPropsWithoutRef, ComponentPropsWithRef } from 'react'

export const ListItem = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div
      className={cn(
        'mb-2 flex w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-col justify-between rounded-lg px-3 py-[7px] text-sm',
        'transition-colors duration-100',
        'hover:bg-[var(--color-list-item-hover)]',
        'active:bg-[var(--color-list-item)] active:shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
        '[.menu]:text-[var(--color-text-3)] [.menu]:opacity-0',
        'hover:[.menu]:opacity-1',
        'active:[.menu]:opacity-1 active:[.menu]:hover:text-[var(--color-text-2)]',
        'singlealone:rounded-none singlealone:hover:bg-[var(--color-background-soft)] singlealone:active:border-[var(--color-primary)] singlealone:active:border-l-2 singlealone:active:shadow-none',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}
export const ListItemNameContainer = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div className={cn('flex h-5 flex-row items-center justify-between gap-1', className)} {...props}>
      {children}
    </div>
  )
}

export const ListItemName = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div
      className={cn('relative overflow-hidden text-sm', 'will-change-[background-position,width]', className)}
      style={{
        display: '-webkit-box',
        WebkitLineClamp: 1,
        WebkitBoxOrient: 'vertical',
        WebkitBoxFlex: 1,
        ...props.style
      }}
      {...props}>
      {children}
    </div>
  )
}

export const ListItemEditInput = ({ className, ...props }: ComponentPropsWithRef<'input'>) => {
  return (
    <input
      className={cn(
        'w-full border-none bg-[var(--color-background)] p-0 px-[6px] py-[2px] font-inherit text-[var(--color-text-1)] text-sm outline-none',
        className
      )}
      {...props}
    />
  )
}

export const ListContainer = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div className={cn('flex h-full w-full flex-col p-2', className)} {...props}>
      {children}
    </div>
  )
}
