import type { ComponentPropsWithoutRef, CSSProperties } from 'react'

export function PlaceholderShimmerText({ className, style, ...props }: ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      className={['animation-shimmer motion-reduce:!animate-none', className].filter(Boolean).join(' ')}
      style={
        {
          '--color-shimmer-mid': 'var(--color-foreground-secondary)',
          '--color-shimmer-end': 'color-mix(in srgb, var(--color-foreground-secondary) 35%, transparent)',
          ...style
        } as CSSProperties
      }
      {...props}
    />
  )
}
