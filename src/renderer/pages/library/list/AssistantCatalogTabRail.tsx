import { Button, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { AssistantPresetGroupIcon } from '@renderer/pages/store/assistants/presets/components/AssistantPresetGroupIcon'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
        aria-label={t('library.assistant_catalog.scroll_left')}
        onClick={() => scrollRail(-1)}
        className="h-7 min-h-0 w-7 shrink-0 rounded-full p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronLeft size={14} />
      </Button>
      <div className="relative min-w-0 flex-1">
        <div ref={railRef} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tabs variant="line" value={activeTab} onValueChange={onTabChange} className="block">
            <TabsList className="h-auto gap-6 px-1 pr-8">
              {tabs.map((tab) => {
                const groupIconName = tab.id === ASSISTANT_CATALOG_MY_TAB ? '我的' : tab.id
                return (
                  <TabsTrigger key={tab.id} value={tab.id} className="h-10 shrink-0 gap-2 px-0 text-sm">
                    <AssistantPresetGroupIcon groupName={groupIconName} size={15} />
                    <span>{tab.label}</span>
                    <span className="rounded-full bg-accent/70 px-1.5 py-px text-[11px] text-muted-foreground/45 tabular-nums">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-background to-transparent" />
      </div>
      <Button
        variant="ghost"
        aria-label={t('library.assistant_catalog.scroll_right')}
        onClick={() => scrollRail(1)}
        className="h-7 min-h-0 w-7 shrink-0 rounded-full p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}
