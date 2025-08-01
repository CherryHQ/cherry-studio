import { CherryStoreType } from '@renderer/types/cherryStore'
import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { ROUTERS, ROUTERS_MAP } from '../routers'

export function useDiscoverCategories() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTabId = useMemo(() => {
    // e.g., location.pathname = /discover/assistant, segments = ['discover', 'assistant']
    const pathSegments = location.pathname.split('/').filter(Boolean)
    const currentTabId = pathSegments[1] as CherryStoreType

    return ROUTERS_MAP.has(currentTabId) ? currentTabId : ROUTERS[0].id
  }, [location.pathname])

  const activeCategoryId = useMemo(() => {
    return searchParams.get('categoryId') || 'all'
  }, [searchParams])

  const handleSelectTab = useCallback(
    (newTabId: string) => {
      if (activeTabId !== newTabId) {
        navigate(`/discover/${newTabId}`)
      }
    },
    [activeTabId, navigate]
  )

  const handleSelectCategory = useCallback(
    (newCategoryId: string) => {
      if (activeCategoryId !== newCategoryId) {
        setSearchParams({ categoryId: newCategoryId })
      }
    },
    [activeCategoryId, setSearchParams]
  )

  const currentCategory = useMemo(() => {
    return ROUTERS_MAP.get(activeTabId)
  }, [activeTabId])

  return {
    activeTabId,
    activeCategoryId,
    currentCategory,
    handleSelectTab,
    handleSelectCategory
  }
}
