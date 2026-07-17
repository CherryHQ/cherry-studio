import { Button } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentType } from 'react'

/**
 * Kept for call-site semantics only — every preset renders the same unified
 * empty illustration below, so all modules read as one product.
 */
export type EmptyStatePreset =
  | 'no-model'
  | 'no-assistant'
  | 'no-agent'
  | 'no-knowledge'
  | 'no-file'
  | 'no-note'
  | 'no-miniapp'
  | 'no-code-tool'
  | 'no-resource'
  | 'no-translate'
  | 'no-result'
  | 'no-topic'
  | 'no-session'

type EmptyStateIcon = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>

/** Variants of the unified empty illustration, all drawn in one visual family. */
export type EmptyStateIllustration = 'inbox' | 'book'

const EMPTY_ILLUSTRATION_RATIO = 41 / 64

/**
 * Unified empty illustrations — soft line drawings with a ground shadow. All
 * colors derive from `currentColor` opacity layers so they adapt to themes.
 * `inbox` is the generic "nothing here"; `book` reads as knowledge/learning.
 */
function EmptyIllustration({
  variant = 'inbox',
  width,
  className
}: {
  variant?: EmptyStateIllustration
  width: number
  className?: string
}) {
  return (
    <svg
      width={width}
      height={Math.round(width * EMPTY_ILLUSTRATION_RATIO)}
      viewBox="0 0 64 41"
      className={className}
      aria-hidden="true">
      {variant === 'book' ? (
        <g transform="translate(0 1)" fill="none" fillRule="evenodd">
          <ellipse fill="currentColor" fillOpacity={0.08} cx="32" cy="33" rx="28" ry="6.5" />
          <g stroke="currentColor" strokeOpacity={0.4} strokeLinejoin="round">
            <path fill="currentColor" fillOpacity={0.05} d="M32 10.5 11 6.5v18.2L32 30.5Z" />
            <path fill="currentColor" fillOpacity={0.05} d="M32 10.5 53 6.5v18.2L32 30.5Z" />
            <path d="M32 10.5v20" />
          </g>
          <path
            fill="currentColor"
            fillOpacity={0.35}
            d="m55.5 0 1.3 2.8 2.8 1.3-2.8 1.3-1.3 2.8-1.3-2.8-2.8-1.3 2.8-1.3Z"
          />
        </g>
      ) : (
        <g transform="translate(0 1)" fill="none" fillRule="evenodd">
          <ellipse fill="currentColor" fillOpacity={0.08} cx="32" cy="33" rx="32" ry="7" />
          <g fillRule="nonzero" stroke="currentColor" strokeOpacity={0.4}>
            <path d="M55 12.76 44.854 1.258C44.367.474 43.656 0 42.907 0H21.093c-.749 0-1.46.474-1.947 1.257L9 12.761V22h46v-9.24z" />
            <path
              fill="currentColor"
              fillOpacity={0.05}
              d="M41.613 15.931c0-1.605.994-2.93 2.227-2.931H55v18.137C55 33.26 53.68 35 52.05 35h-40.1C10.32 35 9 33.259 9 31.137V13h11.16c1.233 0 2.227 1.323 2.227 2.928v.022c0 1.605 1.005 2.901 2.237 2.901h14.752c1.232 0 2.237-1.308 2.237-2.913v-.007z"
            />
          </g>
        </g>
      )}
    </svg>
  )
}

export interface EmptyStateProps {
  preset?: EmptyStatePreset
  /** Which unified illustration to render (ignored when `icon` is set). */
  illustration?: EmptyStateIllustration
  icon?: EmptyStateIcon
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  compact?: boolean
  className?: string
}

export function EmptyState({
  illustration = 'inbox',
  icon: IconOverride,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  className
}: EmptyStateProps) {
  const Icon = IconOverride
  const buttonSize = compact ? 'sm' : 'default'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'flex-1 px-6 py-12',
        className
      )}>
      {Icon ? (
        <Icon
          size={compact ? 28 : 40}
          strokeWidth={1.5}
          className={cn('text-muted-foreground', compact ? 'mb-3' : 'mb-4')}
        />
      ) : (
        <EmptyIllustration
          variant={illustration}
          width={compact ? 48 : 64}
          className={cn('text-muted-foreground', compact ? 'mb-3' : 'mb-4')}
        />
      )}
      {title && (
        <h3
          className={cn(
            'font-normal text-muted-foreground',
            compact ? 'text-xs' : 'text-sm',
            description ? 'mb-1.5' : actionLabel || secondaryLabel ? (compact ? 'mb-3' : 'mb-5') : ''
          )}>
          {title}
        </h3>
      )}
      {description && (
        <p
          className={cn(
            'text-muted-foreground',
            compact ? 'mb-3 max-w-xs text-xs' : 'mb-5 max-w-md text-xs leading-relaxed'
          )}>
          {description}
        </p>
      )}
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-2">
          {actionLabel && onAction && (
            <Button variant="outline" size={buttonSize} onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button variant="ghost" size={buttonSize} onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
