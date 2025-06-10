import { NavbarCenter, NavbarMain } from '@renderer/components/app/Navbar'
// import { useRuntime } from '@renderer/hooks/useRuntime' // No longer needed if resourcesPath is not used
import { Tabs as VercelTabs } from '@renderer/ui/vercel-tabs'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

// Import Context and the main Dialog Manager component
import DiscoverContent from './components/DiscoverContent' // Removed DiscoverContent import
import DiscoverSidebar from './components/DiscoverSidebar'
import { InternalCategory, useDiscoverCategories } from './hooks/useDiscoverCategories'

// Function to adapt categories for VercelTabs
const adaptCategoriesForVercelTabs = (categories: InternalCategory[]) => {
  return categories.map((category) => ({
    id: category.id, // VercelTabs expects `id`
    label: category.title // VercelTabs expects `label`
  }))
}

export default function DiscoverPage() {
  const { t } = useTranslation()
  const {
    categories,
    activeTab,
    selectedSubcategory,
    currentCategory,
    handleSelectTab,
    handleSelectSubcategory,
    setActiveTab
  } = useDiscoverCategories()

  // Path like /discover/:categoryIdFromUrl. categoryIdFromUrl is lowercase from URL.
  const { categoryIdFromUrl } = useParams<{ categoryIdFromUrl: string }>()

  useEffect(() => {
    const matchedCategory = categories.find((cat) => cat.id.toLowerCase() === categoryIdFromUrl?.toLowerCase())
    if (matchedCategory && activeTab !== matchedCategory.id) {
      setActiveTab(matchedCategory.id)
    }
  }, [categoryIdFromUrl, categories, activeTab, setActiveTab])

  const vercelTabsData = adaptCategoriesForVercelTabs(categories)

  return (
    <div className="h-full w-full">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <NavbarMain className="h-auto flex-shrink-0">
          <NavbarCenter>{t('discover.title')}</NavbarCenter>
        </NavbarMain>

        {categories.length > 0 && (
          <div className="px-4 py-2">
            <VercelTabs tabs={vercelTabsData} onTabChange={handleSelectTab} />
          </div>
        )}

        <div className="flex flex-grow flex-row overflow-auto">
          {currentCategory?.hasSidebar && (
            <div className="w-64 flex-shrink-0 border-r">
              <DiscoverSidebar
                activeCategory={currentCategory}
                selectedSubcategory={selectedSubcategory}
                onSelectSubcategory={handleSelectSubcategory}
              />
            </div>
          )}
          {/* {!currentCategory && categories.length > 0 && (
            <div className="w-64 flex-shrink-0 border-r p-4 text-muted-foreground">Select a category...</div>
          )} */}

          <main className="flex-grow overflow-hidden">
            <DiscoverContent
              activeTabId={activeTab}
              // selectedSubcategoryId={selectedSubcategory}
              currentCategory={currentCategory}
            />
          </main>
        </div>
      </div>
    </div>
  )
}
