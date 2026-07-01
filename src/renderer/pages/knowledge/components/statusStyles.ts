export const statusDotClassNames = {
  completed: 'bg-success/60',
  processing: 'bg-warning',
  failed: 'bg-destructive'
} as const

export const statusBadgeClassNames = {
  completed: 'border-transparent bg-success/10 text-success',
  processing: 'border-transparent bg-warning/10 text-warning',
  failed: 'border-transparent bg-destructive/10 text-destructive'
} as const
