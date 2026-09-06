import type { Button } from '@cherrystudio/ui/components/primitives/button'
import { buttonVariants } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'
import * as React from 'react'

import { DirectionalIcon } from './directional-icon'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="pagination-content" className={cn('flex flex-row items-center gap-1', className)} {...props} />
}

function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
  React.ComponentProps<'a'>

function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size
        }),
        'text-foreground hover:text-primary hover:shadow-none hover:bg-primary/10 rounded-md',
        isActive && 'bg-background text-primary',
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  children = 'Previous',
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn('gap-1 px-2.5 sm:ps-2.5', className)}
      {...props}>
      <DirectionalIcon>
        <ChevronLeftIcon />
      </DirectionalIcon>
      <span className="hidden sm:block">{children}</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, children = 'Next', ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn('gap-1 px-2.5 sm:pe-2.5', className)}
      {...props}>
      <span className="hidden sm:block">{children}</span>
      <DirectionalIcon>
        <ChevronRightIcon />
      </DirectionalIcon>
    </PaginationLink>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn('flex size-9 items-center justify-center', className)}
      {...props}>
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
}
