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
export const ListItemNameContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  height: 20px;
  justify-content: space-between;
`

export const ListItemName = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  position: relative;
  will-change: background-position, width;

  --color-shimmer-mid: var(--color-text-1);
  --color-shimmer-end: color-mix(in srgb, var(--color-text-1) 25%, transparent);

  &.shimmer {
    background: linear-gradient(to left, var(--color-shimmer-end), var(--color-shimmer-mid), var(--color-shimmer-end));
    background-size: 200% 100%;
    background-clip: text;
    color: transparent;
    animation: shimmer 3s linear infinite;
  }

  &.typing {
    display: block;
    -webkit-line-clamp: unset;
    -webkit-box-orient: unset;
    white-space: nowrap;
    overflow: hidden;
    animation: typewriter 0.5s steps(40, end);
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes typewriter {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }
`

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
