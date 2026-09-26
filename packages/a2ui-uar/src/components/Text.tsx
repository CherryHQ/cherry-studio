import type { TextApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import type { ElementType, FC } from 'react'

import { cn } from '../lib/cn'
import { resolvedText } from '../lib/resolved'
import type { UarComponentProps } from '../react/types'

const VARIANT_TAG = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  caption: 'span',
  body: 'p'
} as const

const VARIANT_CLASS: Record<keyof typeof VARIANT_TAG, string> = {
  h1: 'text-3xl font-semibold tracking-tight',
  h2: 'text-2xl font-semibold tracking-tight',
  h3: 'text-xl font-semibold',
  h4: 'text-lg font-medium',
  h5: 'text-base font-medium',
  caption: 'text-xs text-muted-foreground',
  body: 'text-sm'
}

/** `Text` — the `uar.a2ui/1` typographic primitive. `text` supports simple Markdown-free formatting per the spec; we render it as plain text (no HTML injection). */
export const UarText: FC<{ props: UarComponentProps<typeof TextApi> }> = ({ props }) => {
  const variant = (props.variant ?? 'body') as keyof typeof VARIANT_TAG
  const Tag = VARIANT_TAG[variant] as ElementType
  return (
    <Tag
      data-a2ui-component="Text"
      className={cn(VARIANT_CLASS[variant])}
      aria-label={resolvedText(props.accessibility?.label)}
      title={resolvedText(props.accessibility?.description)}>
      {props.text}
    </Tag>
  )
}
