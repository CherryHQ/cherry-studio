import { useCallback, useState } from 'react'

export interface UseSelectionStateOptions {
  selectedId?: string | null
  defaultSelectedId?: string | null
  onSelectedChange?: (id: string | null) => void
}

export interface UseSelectionStateReturn {
  selectedId: string | null
  select: (id: string | null) => void
  isSelected: (id: string) => boolean
}

export function useSelectionState(options: UseSelectionStateOptions): UseSelectionStateReturn {
  const { selectedId: controlled, defaultSelectedId, onSelectedChange } = options
  const isControlled = controlled !== undefined
  const [internal, setInternal] = useState<string | null>(defaultSelectedId ?? null)
  const current = isControlled ? (controlled ?? null) : internal

  const select = useCallback(
    (id: string | null) => {
      if (!isControlled) setInternal(id)
      onSelectedChange?.(id)
    },
    [isControlled, onSelectedChange]
  )

  const isSelected = useCallback((id: string) => current === id, [current])

  return { selectedId: current, select, isSelected }
}
