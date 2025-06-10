import { Category } from '@renderer/types/cherryStore'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { discoverRouters } from '../routers'

// Extended Category type for internal use in hook, including path and sidebar flag
// Export this interface so other files can import it
export interface InternalCategory extends Category {
  path: string
  hasSidebar?: boolean // Optional: defaults to true if not specified, or handle explicitly
}

// Initial category data with path and hasSidebar
const initialCategories: InternalCategory[] = discoverRouters.map((router) => ({
  id: router.id,
  title: router.title,
  path: router.path,
  hasSidebar: !router.component,
  // 目前没有需要二级分类的分类
  items: []
}))

// Helper to find category by path
const findCategoryByPath = (path: string | undefined): InternalCategory | undefined =>
  initialCategories.find((cat) => cat.path === path)

// Helper to find category by id (activeTab)
const findCategoryById = (id: string | undefined): InternalCategory | undefined =>
  initialCategories.find((cat) => cat.id === id)

export function useDiscoverCategories() {
  const [categories, setCategories] = useState<InternalCategory[]>(initialCategories)
  const [activeTab, setActiveTab] = useState<string>('')
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('all')

  const navigate = useNavigate()
  const location = useLocation()

  // Effect to initialize activeTab from URL path segment or navigate to default
  useEffect(() => {
    const pathSegments = location.pathname.split('/').filter(Boolean) // e.g., ["discover", "assistant"]
    // Expects URL like /discover/:categoryPathSegment/...
    const currentCategoryPath = pathSegments.length >= 2 && pathSegments[0] === 'discover' ? pathSegments[1] : undefined

    const categoryFromPath = findCategoryByPath(currentCategoryPath)

    // Synchronize active tab with the category determined from the URL path.
    // If a category is found from the path, update the active tab to match its ID.
    if (categoryFromPath) {
      if (activeTab !== categoryFromPath.id) {
        setActiveTab(categoryFromPath.id)
      }
    } else if (location.pathname === '/discover' || location.pathname === '/discover/') {
      // Handle the case where the URL is the base /discover path.
      // Redirect to the first category's path to ensure a category is always selected.
      if (categories.length > 0) {
        const firstCategory = categories[0]
        if (firstCategory?.path) {
          navigate(`/discover/${firstCategory.path}?subcategory=all`, { replace: true })
        }
      }
    } else if (!currentCategoryPath && categories.length > 0 && !activeTab) {
      // Fallback for invalid or unmatched /discover/xxx URLs.
      // If the URL contains a path segment that doesn't correspond to a known category,
      // and no tab is active, redirect to the first valid category.
      const firstCategory = categories[0]
      if (firstCategory?.path) {
        navigate(`/discover/${firstCategory.path}?subcategory=all`, { replace: true })
      }
    }
    // If categoryFromPath is undefined, and it's not /discover, it means it's an invalid path like /discover/unknown
    // In this case, we don't navigate from here; ideally App.tsx has a NotFound route, or DiscoverContent shows a message.
  }, [location.pathname, categories, activeTab, navigate])

  // Effect to initialize selectedSubcategory from URL query param or default to 'all'
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const subcategoryIdFromQuery = searchParams.get('subcategory')
    const currentCatDetails = findCategoryById(activeTab) // Use the helper here

    if (subcategoryIdFromQuery && currentCatDetails) {
      // Check if the subcategory from query is valid for the current active category
      if (currentCatDetails.items.some((item) => item.id === subcategoryIdFromQuery)) {
        if (selectedSubcategory !== subcategoryIdFromQuery) {
          setSelectedSubcategory(subcategoryIdFromQuery)
        }
        return // Valid subcategory from URL is set, no further action needed in this effect iteration
      }
    }

    // If no valid subcategory in query, or if activeTab has changed and subcategory needs reset/defaulting
    if (activeTab && currentCatDetails) {
      const defaultSub = currentCatDetails.items.find((item) => item.id === 'all') || currentCatDetails.items[0]
      if (defaultSub) {
        // Ensure defaultSub exists
        // Set selectedSubcategory state first
        if (selectedSubcategory !== defaultSub.id) {
          setSelectedSubcategory(defaultSub.id)
        }
        // Then, if URL doesn't match this default, update URL to reflect the default subcategory
        // This ensures the URL is the source of truth / always consistent.
        if (!subcategoryIdFromQuery || subcategoryIdFromQuery !== defaultSub.id) {
          const newSearchParams = new URLSearchParams() // Start with clean params for this path
          newSearchParams.set('subcategory', defaultSub.id)
          // Ensure we use the current actual path from currentCatDetails if available for navigation
          // This avoids issues if location.pathname is briefly out of sync during transitions.
          const basePath = currentCatDetails.path
            ? `/discover/${currentCatDetails.path}`
            : location.pathname.split('?')[0]
          navigate(`${basePath}?${newSearchParams.toString()}`, { replace: true })
        }
      }
    }
  }, [activeTab, location.search, categories, navigate, selectedSubcategory]) // location.pathname removed as basePath logic handles path part

  const currentCategory = useMemo(() => {
    return findCategoryById(activeTab) // Use the helper here
  }, [activeTab]) // categories removed from deps as findCategoryById uses stable initialCategories

  const handleSelectTab = (tabId: string) => {
    const categoryToSelect = findCategoryById(tabId)
    if (categoryToSelect && categoryToSelect.path && activeTab !== tabId) {
      navigate(`/discover/${categoryToSelect.path}?subcategory=all`)
    }
  }

  const handleSelectSubcategory = (subcategoryId: string) => {
    const currentCatDetails = findCategoryById(activeTab)
    if (selectedSubcategory !== subcategoryId && currentCatDetails?.path) {
      const newSearchParams = new URLSearchParams()
      newSearchParams.set('subcategory', subcategoryId)
      navigate(`/discover/${currentCatDetails.path}?${newSearchParams.toString()}`, { replace: false })
    }
  }

  // Ensure each category has an "All" subcategory (runs once on mount)
  useEffect(() => {
    setCategories((prev) =>
      prev.map((cat) => {
        if (!cat.items.some((item) => item.id === 'all')) {
          return { ...cat, items: [{ id: 'all', name: `All ${cat.title}` }, ...cat.items] }
        }
        return cat
      })
    )
  }, [])

  return {
    categories,
    activeTab,
    selectedSubcategory,
    currentCategory,
    handleSelectTab,
    handleSelectSubcategory,
    setActiveTab
  }
}
