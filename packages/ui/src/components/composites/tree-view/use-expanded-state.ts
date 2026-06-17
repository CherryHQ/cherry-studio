import { useCallback, useRef, useState } from 'react'

export interface UseExpandedStateOptions {
  expandedIds?: ReadonlySet<string>
  defaultExpandedIds?: ReadonlySet<string>
  onExpandedChange?: (next: ReadonlySet<string>) => void
}

export interface UseExpandedStateReturn {
  expandedIds: ReadonlySet<string>
  toggle: (id: string) => void
  isExpanded: (id: string) => boolean
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export function useExpandedState(options: UseExpandedStateOptions): UseExpandedStateReturn {
  const { expandedIds: controlled, defaultExpandedIds, onExpandedChange } = options
  const isControlled = controlled !== undefined
  const [internal, setInternal] = useState<ReadonlySet<string>>(defaultExpandedIds ?? EMPTY_SET)
  const internalRef = useRef(internal)
  internalRef.current = internal
  const current = isControlled ? controlled : internal

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(isControlled ? controlled : internalRef.current)
      if (next.has(id)) next.delete(id)
      else next.add(id)

      if (!isControlled) {
        internalRef.current = next
        setInternal(next)
      }
      onExpandedChange?.(next)
    },
    [controlled, isControlled, onExpandedChange]
  )

  const isExpanded = useCallback((id: string) => current.has(id), [current])

  return { expandedIds: current, toggle, isExpanded }
}
