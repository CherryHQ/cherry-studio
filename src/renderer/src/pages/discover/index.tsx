import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { Tabs } from '@renderer/ui/vercel-tabs'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import DiscoverMain from './components/DiscoverMain'
import DiscoverSidebar from './components/DiscoverSidebar'
import { useDiscoverCategories } from './hooks/useDiscoverCategories'
import { ROUTERS } from './routers'

export default function DiscoverPage() {
  const { t } = useTranslation()
  const { activeTabId, currentCategory, handleSelectTab } = useDiscoverCategories()

  const tabs = useMemo(() => ROUTERS.map((router) => ({ id: router.id, label: router.title })), [])

  return (
    <div className="h-full w-full">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none', justifyContent: 'space-between' }}>
            {t('discover.title')}
          </NavbarCenter>
        </Navbar>

        {ROUTERS.length > 0 && (
          <div className="p-2 pl-0">
            <Tabs tabs={tabs} activeTab={activeTabId} onTabChange={handleSelectTab} />
          </div>
        )}

        <div className="flex flex-row overflow-hidden">
          {currentCategory?.hasSidebar && (
            <div className="w-64 flex-shrink-0 border-r">
              <DiscoverSidebar activeCategory={currentCategory} />
            </div>
          )}

          <main className="w-full overflow-hidden">
            <DiscoverMain />
          </main>
        </div>
      </div>
    </div>
  )
}
