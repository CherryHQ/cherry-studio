import { cn } from '@heroui/react'
import { ComponentPropsWithoutRef, ComponentPropsWithRef } from 'react'
import styled from 'styled-components'

export const ListItem = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div
      className={cn(
        'mb-2 flex w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-col justify-between rounded-lg px-3 py-2 text-sm',
        'transition-colors duration-100',
        'hover:bg-[var(--color-list-item-hover)]',
        '[.active]:bg-[var(--color-list-item)] [.active]:shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
        '[&_.menu]:text-[var(--color-text-3)] [&_.menu]:opacity-0',
        'hover:[&_.menu]:opacity-100',
        '[.active]:[&_.menu]:opacity-100 [.active]:[&_.menu]:hover:text-[var(--color-text-2)]',
        '[.singlealone.active]:border-[var(--color-primary)] [.singlealone.active]:border-l-2 [.singlealone.active]:shadow-none [.singlealone]:rounded-none [.singlealone]:hover:bg-[var(--color-background-soft)]',
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
