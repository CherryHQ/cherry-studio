import { Button, CustomTag, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Book, Folder, Globe, Link, Notebook, PlusIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_TAB_DEFINITIONS, type TabKey } from '../constants/tabs'
import { useKnowledgeBaseCtx, useKnowledgeItemsCtx, useKnowledgeUICtx } from '../context'
import { useKnowledgeTabAddAction } from '../hooks/addActions'
import KnowledgeDirectories from '../items/KnowledgeDirectories'
import KnowledgeFiles from '../items/KnowledgeFiles'
import KnowledgeNotes from '../items/KnowledgeNotes'
import KnowledgeSitemaps from '../items/KnowledgeSitemaps'
import KnowledgeUrls from '../items/KnowledgeUrls'

interface TabViewModel {
  key: TabKey
  title: string
  addButtonLabel: string
  icon: ReactNode
  itemCount: number
  content: ReactNode
}

const renderTabIcon = (key: TabKey, className?: string) => {
  switch (key) {
    case 'files':
      return <Book size={16} className={className} />
    case 'notes':
      return <Notebook size={16} className={className} />
    case 'directories':
      return <Folder size={16} className={className} />
    case 'urls':
      return <Link size={16} className={className} />
    case 'sitemaps':
      return <Globe size={16} className={className} />
    default:
      return null
  }
}

const KnowledgeTabs: FC = () => {
  const { t } = useTranslation()
  const { selectedBase } = useKnowledgeBaseCtx()
  const { itemsByType } = useKnowledgeItemsCtx()
  const { activeTab, setActiveTab } = useKnowledgeUICtx()
  const currentAction = useKnowledgeTabAddAction()

  const tabItems = useMemo<TabViewModel[]>(() => {
    const itemCounts: Record<TabKey, number> = {
      files: itemsByType.files.length,
      notes: itemsByType.notes.length,
      directories: itemsByType.directories.length,
      urls: itemsByType.urls.length,
      sitemaps: itemsByType.sitemaps.length
    }

    const tabContent: Record<TabKey, ReactNode> = selectedBase
      ? {
          files: <KnowledgeFiles />,
          notes: <KnowledgeNotes />,
          directories: <KnowledgeDirectories />,
          urls: <KnowledgeUrls />,
          sitemaps: <KnowledgeSitemaps />
        }
      : {
          files: null,
          notes: null,
          directories: null,
          urls: null,
          sitemaps: null
        }

    return KNOWLEDGE_TAB_DEFINITIONS.map((tab) => ({
      key: tab.key,
      title: t(tab.titleKey),
      addButtonLabel: t(tab.addButtonLabelKey),
      icon: renderTabIcon(tab.key, cn(activeTab === tab.key ? 'text-primary' : undefined)),
      itemCount: itemCounts[tab.key],
      content: tabContent[tab.key]
    }))
  }, [activeTab, selectedBase, itemsByType, t])

  const currentTab = tabItems.find((tab) => tab.key === activeTab)

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)} variant="line" className="flex-1">
      <div className="mx-4 flex h-12 items-center justify-between border-b-0 bg-transparent p-0">
        <TabsList className="h-full justify-start gap-1 bg-transparent p-0">
          {tabItems.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="gap-1.5 px-3 py-3 text-[13px]">
              {item.icon}
              <span>{item.title}</span>
              <div></div>
              <CustomTag size={10} color={item.itemCount > 0 ? '#00b96b' : '#cccccc'}>
                {item.itemCount}
              </CustomTag>
            </TabsTrigger>
          ))}
        </TabsList>
        <Button
          className="h-8 rounded-2xs"
          size="sm"
          variant="outline"
          onClick={currentAction.handler}
          disabled={currentAction.disabled || currentAction.loading}>
          <PlusIcon className="text-primary" />
          {currentTab?.addButtonLabel}
        </Button>
      </div>
      {tabItems.map((item) => (
        <TabsContent key={item.key} value={item.key} className="h-full overflow-hidden">
          {item.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export default KnowledgeTabs
