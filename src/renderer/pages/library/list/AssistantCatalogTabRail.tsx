import { Button, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { AssistantPresetGroupIcon } from './AssistantPresetGroupIcon'
import { ASSISTANT_CATALOG_MY_TAB, type AssistantCatalogTab } from './useAssistantPresetCatalog'

interface AssistantCatalogTabRailProps {
  tabs: AssistantCatalogTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function AssistantCatalogTabRail({ tabs, activeTab, onTabChange }: AssistantCatalogTabRailProps) {
  const { t } = useTranslation()
  const railRef = useRef<HTMLDivElement>(null)
  const scrollRail = (direction: -1 | 1) => {
    railRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' })
  }

  return (
    <div className="flex items-center gap-1 px-5 pb-3">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('library.assistant_catalog.scroll_left')}
        onClick={() => scrollRail(-1)}
        className="shrink-0 rounded-full text-foreground-muted hover:text-foreground">
        <ChevronLeft size={14} />
      </Button>
      <div className="relative min-w-0 flex-1">
        <div ref={railRef} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tabs variant="line" value={activeTab} onValueChange={onTabChange} className="block">
            <TabsList className="h-auto gap-6 px-1 pe-8">
              {tabs.map((tab) => {
                const groupIconName = tab.id === ASSISTANT_CATALOG_MY_TAB ? '我的' : tab.id
                return (
                  <TabsTrigger key={tab.id} value={tab.id} className="h-10 shrink-0 gap-2 px-0 text-sm">
                    <AssistantPresetGroupIcon groupName={groupIconName} size={15} />
                    <span>{tab.label}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-px text-foreground-muted text-xs tabular-nums">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
        <div className="pointer-events-none absolute inset-y-0 end-0 w-10 bg-linear-to-l from-background to-transparent" />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('library.assistant_catalog.scroll_right')}
        onClick={() => scrollRail(1)}
        className="shrink-0 rounded-full text-foreground-muted hover:text-foreground">
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}
