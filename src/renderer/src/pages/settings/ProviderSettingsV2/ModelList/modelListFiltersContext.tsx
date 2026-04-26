import type { ReactNode } from 'react'
import { createContext, startTransition, use, useCallback, useMemo, useState } from 'react'

import type { ModelListCapabilityFilter } from './modelListDerivedState'

interface ModelListFiltersContextValue {
  searchText: string
  setSearchText: (text: string) => void
  selectedCapabilityFilter: ModelListCapabilityFilter
  setSelectedCapabilityFilter: (filter: ModelListCapabilityFilter) => void
}

const ModelListFiltersContext = createContext<ModelListFiltersContextValue | null>(null)

export function ModelListFiltersProvider({ children }: { children: ReactNode }) {
  const [searchText, setSearchTextState] = useState('')
  const [selectedCapabilityFilter, setSelectedCapabilityFilterState] = useState<ModelListCapabilityFilter>('all')

  const setSearchText = useCallback((text: string) => {
    startTransition(() => setSearchTextState(text))
  }, [])

  const setSelectedCapabilityFilter = useCallback((filter: ModelListCapabilityFilter) => {
    startTransition(() => setSelectedCapabilityFilterState(filter))
  }, [])

  const value = useMemo(
    () => ({
      searchText,
      setSearchText,
      selectedCapabilityFilter,
      setSelectedCapabilityFilter
    }),
    [searchText, selectedCapabilityFilter, setSearchText, setSelectedCapabilityFilter]
  )

  return <ModelListFiltersContext value={value}>{children}</ModelListFiltersContext>
}

export function useModelListFilters() {
  const context = use(ModelListFiltersContext)

  if (!context) {
    throw new Error('useModelListFilters must be used within ModelListFiltersProvider')
  }

  return context
}
