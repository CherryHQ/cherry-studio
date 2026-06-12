export const statusDotClassNames = {
  completed: 'bg-primary/60',
  processing: 'bg-amber-500',
  failed: 'bg-destructive'
} as const

export const statusBadgeClassNames = {
  completed: 'border-transparent bg-success/10 text-success',
  processing: 'border-transparent bg-warning/10 text-warning',
  failed: 'border-transparent bg-destructive/10 text-destructive'
} as const
