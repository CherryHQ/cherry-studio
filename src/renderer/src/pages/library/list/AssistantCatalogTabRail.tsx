import { Button } from '@cherrystudio/ui'
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
        className="h-8 min-h-0 w-8 shrink-0 rounded-xs p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronLeft size={15} />
      </Button>
      <div className="relative min-w-0 flex-1">
        <div
          ref={railRef}
          className="flex items-center gap-6 overflow-x-auto px-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            const groupIconName = tab.id === ASSISTANT_CATALOG_MY_TAB ? '我的' : tab.id
            return (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                onClick={() => onTabChange(tab.id)}
                className={`group relative flex h-10 min-h-0 shrink-0 items-center gap-2 rounded-none px-0 font-normal text-sm shadow-none outline-none transition-colors hover:bg-transparent focus-visible:ring-0 ${
                  active ? 'text-foreground' : 'text-muted-foreground/55 hover:text-foreground'
                }`}>
                <span className={active ? 'text-foreground/70' : 'text-muted-foreground/55'}>
                  <AssistantPresetGroupIcon groupName={groupIconName} size={15} />
                </span>
                <span>{tab.label}</span>
                <span className="rounded-full bg-accent/70 px-1.5 py-px text-[11px] text-muted-foreground/45 tabular-nums">
                  {tab.count}
                </span>
                <span
                  className={`absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-35'
                  }`}
                />
              </Button>
            )
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
      </div>
      <Button
        variant="ghost"
        aria-label={t('library.assistant_catalog.scroll_right')}
        onClick={() => scrollRail(1)}
        className="h-8 min-h-0 w-8 shrink-0 rounded-xs p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronRight size={15} />
      </Button>
    </div>
  )
}
