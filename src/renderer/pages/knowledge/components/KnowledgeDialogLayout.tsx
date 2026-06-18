import { DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export const KnowledgeDialogHeader = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <DialogHeader className={cn('pe-8 text-start', className)}>
      <DialogTitle>{children}</DialogTitle>
    </DialogHeader>
  )
}

export const KnowledgeDialogBody = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={cn('space-y-3', className)} {...props} />
}

export const KnowledgeDialogField = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={cn('space-y-1.5', className)} {...props} />
}

export const KnowledgeDialogFooter = ({ className, ...props }: ComponentProps<typeof DialogFooter>) => {
  return <DialogFooter className={className} {...props} />
}
