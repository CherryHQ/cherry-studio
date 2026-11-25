import type { ComponentPropsWithoutRef, CSSProperties } from 'react'

export function PlaceholderShimmerText({ className, style, ...props }: ComponentPropsWithoutRef<'span'>) {
  const shimmerStyle = {
    // These owner-local colors are animation stops, not content foreground roles.
    '--animation-shimmer-mid': 'color-mix(in srgb, var(--foreground) 66.6667%, transparent)',
    '--animation-shimmer-end': 'color-mix(in srgb, var(--animation-shimmer-mid) 35%, transparent)',
    ...style
  } satisfies CSSProperties & {
    '--animation-shimmer-mid': string
    '--animation-shimmer-end': string
  }

  return (
    <span
      className={['animation-shimmer motion-reduce:!animate-none', className].filter(Boolean).join(' ')}
      style={shimmerStyle}
      {...props}
    />
  )
}
