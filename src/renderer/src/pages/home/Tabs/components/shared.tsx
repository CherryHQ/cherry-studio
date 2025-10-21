import { cn } from '@heroui/react'
import { HTMLAttributes } from 'react'
import styled from 'styled-components'

export const ListItem = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'px-3 py-[7px] rounded-lg text-sm flex flex-col justify-between cursor-pointer w-[calc(var(--assistants-width)-20px)] mb-2',
        'transition-colors duration-100',
        'hover:bg-[var(--color-list-item-hover)]',
        'active:bg-[var(--color-list-item)] active:shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
        '[.menu]:opacity-0 [.menu]:text-[var(--color-text-3)]',
        'hover:[.menu]:opacity-1',
        'active:[.menu]:opacity-1 active:[.menu]:hover:text-[var(--color-text-2)]',
        'singlealone:rounded-none singlealone:hover:bg-[var(--color-background-soft)] singlealone:active:border-l-2 singlealone:active:border-[var(--color-primary)] singlealone:active:shadow-none',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
export const ListItemNameContainer = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'flex flex-row items-center gap-1 h-5 justify-between',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export const ListItemName = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'overflow-hidden text-sm relative',
        'will-change-[background-position,width]',
        className
      )}
      style={{
        display: '-webkit-box',
        WebkitLineClamp: 1,
        WebkitBoxOrient: 'vertical',
        WebkitBoxFlex: 1,
        ...props.style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export const ListItemEditInput = styled.input`
  background: var(--color-background);
  border: none;
  color: var(--color-text-1);
  font-size: 13px;
  font-family: inherit;
  padding: 2px 6px;
  width: 100%;
  outline: none;
  padding: 0;
`

export const ListContainer = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn('flex h-full w-full flex-col p-2', className)} {...props}>
      {children}
    </div>
  )
}
