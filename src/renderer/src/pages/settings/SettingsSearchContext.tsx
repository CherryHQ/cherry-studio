import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SEARCH_INDEX, SUBMENU_KEY_MAP, TITLE_TO_ROUTE } from './SettingsSearchConfig'

interface SettingsSearchContextType {
  searchQuery: string
  setSearchQuery: (query: string) => void
  matchingRoutes: Set<string>
  matchingTexts: Map<string, string[]>
  matchingSubMenus: Map<string, Set<string>>
  isSearchActive: boolean
}

const SettingsSearchContext = createContext<SettingsSearchContextType | null>(null)

export const useSettingsSearch = () => {
  const context = use(SettingsSearchContext)
  if (!context) {
    throw new Error('useSettingsSearch must be used within SettingsSearchProvider')
  }
  return context
}

interface SettingsSearchProviderProps {
  children: ReactNode
}

export const SettingsSearchProvider = ({ children }: SettingsSearchProviderProps) => {
  const { t, i18n } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  // Build search index and compute matches
  const { matchingRoutes, matchingTexts, matchingSubMenus } = useMemo(() => {
    const routes = new Set<string>()
    const texts = new Map<string, string[]>()
    const subMenus = new Map<string, Set<string>>()

    if (!searchQuery.trim()) {
      return { matchingRoutes: routes, matchingTexts: texts, matchingSubMenus: subMenus }
    }

    const lowerQuery = searchQuery.toLowerCase()

    // Iterate over the generated search index
    for (const [titleKey, content] of Object.entries(SEARCH_INDEX)) {
      const route = TITLE_TO_ROUTE[titleKey]
      if (!route) continue

      let hasPageMatch = false
      const currentTexts: string[] = []

      if (Array.isArray(content)) {
        // Simple page structure
        content.forEach((key) => {
          const trans = t(key)
          if (trans && trans.toLowerCase().includes(lowerQuery)) {
            hasPageMatch = true
            currentTexts.push(trans)
          }
        })
      } else {
        // Page with sub-menus
        for (const [subTitleKey, keys] of Object.entries(content)) {
          let hasSubMatch = false

          keys.forEach((key) => {
            const trans = t(key)
            if (trans && trans.toLowerCase().includes(lowerQuery)) {
              hasPageMatch = true
              hasSubMatch = true
              currentTexts.push(trans)
            }
          })

          if (hasSubMatch) {
            const subId = SUBMENU_KEY_MAP[subTitleKey]
            if (subId) {
              if (!subMenus.has(route)) {
                subMenus.set(route, new Set())
              }
              subMenus.get(route)!.add(subId)
            }
          }
        }
      }

      if (hasPageMatch) {
        routes.add(route)
        texts.set(route, currentTexts)
      }
    }

    return { matchingRoutes: routes, matchingTexts: texts, matchingSubMenus: subMenus }
  }, [searchQuery, i18n.language, t])

  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  const isSearchActive = searchQuery.trim().length > 0

  const value = useMemo(
    () => ({
      searchQuery,
      setSearchQuery: handleSetSearchQuery,
      matchingRoutes,
      matchingTexts,
      matchingSubMenus,
      isSearchActive
    }),
    [searchQuery, handleSetSearchQuery, matchingRoutes, matchingTexts, matchingSubMenus, isSearchActive]
  )

  return <SettingsSearchContext value={value}>{children}</SettingsSearchContext>
}
