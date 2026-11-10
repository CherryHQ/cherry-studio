import { Gauge, Megaphone, Monitor } from 'lucide-react'
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react'

import { Tooltip } from '@cherrystudio/ui'

export const notificationCategoryIcons = { system: Monitor, usage: Gauge, official: Megaphone }

/** True while the notification row that contains a label holds keyboard focus. */
export const RowKeyboardFocusContext = createContext(false)

/**
 * One-line label that reveals its full text in a tooltip only while it is actually cut off:
 * on hover, or while its row holds keyboard focus.
 */
export function TruncatedLabel({ text }: { text: string }) {
  const rowFocused = use(RowKeyboardFocusContext)
  const label = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [closedByUser, setClosedByUser] = useState(false)
  const measure = (element: HTMLElement) => setTruncated(element.scrollWidth > element.clientWidth)
  useEffect(() => {
    if (rowFocused && label.current) measure(label.current)
    if (!rowFocused) setClosedByUser(false)
  }, [rowFocused])
  return (
    <Tooltip
      content={text}
      isDisabled={!truncated}
      isOpen={rowFocused && truncated && !closedByUser ? true : undefined}
      // Escape must be able to close a focus-opened tooltip, or it would keep swallowing the drawer's Escape.
      onOpenChange={(open) => !open && rowFocused && setClosedByUser(true)}
      asChild>
      <span ref={label} className="block min-w-0 truncate" onPointerEnter={(event) => measure(event.currentTarget)}>
        {text}
      </span>
    </Tooltip>
  )
}

export function notificationPreview(text: string, title = false, hoverHint = true): ReactNode {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim())
  const limit = title ? 60 : 120
  if (characters.length <= limit) return characters.join('')
  return (
    <span className="relative block min-w-0" title={hoverHint ? text : undefined}>
      <span
        className={
          title
            ? 'block truncate pr-3 [mask-image:linear-gradient(to_right,black_80%,transparent)]'
            : 'line-clamp-2 break-words'
        }>
        {characters.slice(0, limit).join('')}
      </span>
      {title && (
        <span aria-hidden="true" className="absolute bottom-0 right-0">
          …
        </span>
      )}
    </span>
  )
}
