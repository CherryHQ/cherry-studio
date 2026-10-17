import { Gauge, Megaphone, Monitor } from 'lucide-react'
import type { ReactNode } from 'react'

export const notificationCategoryIcons = { system: Monitor, usage: Gauge, official: Megaphone }

export function notificationPreview(text: string, title = false): ReactNode {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim())
  const limit = title ? 60 : 120
  if (characters.length <= limit) return characters.join('')
  return (
    <span className="relative block min-w-0" title={text}>
      <span
        className={
          title
            ? 'block truncate pr-3 [mask-image:linear-gradient(to_right,black_80%,transparent)]'
            : 'block max-h-[2lh] overflow-hidden break-words [mask-image:linear-gradient(to_bottom,black_75%,transparent)]'
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
