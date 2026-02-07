import { Button, CustomTag, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useKnowledgeBase, useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import { Book, Folder, Globe, History, Link, Notebook, PlusIcon, Search, Settings } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './components/KnowledgeSearchDialog'
import { KNOWLEDGE_TAB_DEFINITIONS, type TabKey } from './constants/tabs'
import { useKnowledgeAddActions } from './hooks/useKnowledgeAddActions'
import { useKnowledgeQueueActions } from './hooks/useKnowledgeQueueActions'
import KnowledgeDirectories from './items/KnowledgeDirectories'
import KnowledgeFiles from './items/KnowledgeFiles'
import KnowledgeNotes from './items/KnowledgeNotes'
import KnowledgeSitemaps from './items/KnowledgeSitemaps'
import KnowledgeUrls from './items/KnowledgeUrls'
import { groupKnowledgeItemsByType } from './utils/knowledgeItems'

interface KnowledgeContentProps {
  selectedBaseId: string
}

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

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBaseId }) => {
  const { t } = useTranslation()
  const { base } = useKnowledgeBase(selectedBaseId)
  const { items } = useKnowledgeItems(selectedBaseId)

  const { hasOrphans, orphanCount, handleRecover, handleIgnore, isRecovering, isIgnoring } =
    useKnowledgeQueueActions(selectedBaseId)
  const [activeKey, setActiveKey] = useState<TabKey>('files')

  const itemsByType = useMemo(() => groupKnowledgeItemsByType(items), [items])

  const tabItems = useMemo<TabViewModel[]>(() => {
    const itemCounts: Record<TabKey, number> = {
      files: itemsByType.files.length,
      notes: itemsByType.notes.length,
      directories: itemsByType.directories.length,
      urls: itemsByType.urls.length,
      sitemaps: itemsByType.sitemaps.length
    }

    const tabContent: Record<TabKey, ReactNode> = base
      ? {
          files: <KnowledgeFiles selectedBase={base} />,
          notes: <KnowledgeNotes selectedBase={base} />,
          directories: <KnowledgeDirectories selectedBase={base} />,
          urls: <KnowledgeUrls selectedBase={base} />,
          sitemaps: <KnowledgeSitemaps selectedBase={base} />
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
      icon: renderTabIcon(tab.key, cn(activeKey === tab.key ? 'text-primary' : undefined)),
      itemCount: itemCounts[tab.key],
      content: tabContent[tab.key]
    }))
  }, [activeKey, base, itemsByType, t])

  const currentAction = useKnowledgeAddActions({ base: base ?? null, activeKey })
  const currentTab = tabItems.find((tab) => tab.key === activeKey)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  if (!base) {
    return null
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="flex flex-row items-center justify-between border-border border-b px-4 py-2">
        <div className="flex flex-row items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setEditDialogOpen(true)}>
            <Settings size={18} color="var(--color-icon)" />
          </Button>
          <div className="rounded-3xs border border-amber-400/20 bg-amber-400/10 px-2 text-amber-400 text-xs">
            {base.embeddingModelMeta?.name ?? base.embeddingModelId}
          </div>
          {base.rerankModelMeta && (
            <div className="rounded-3xs border border-orange-400/20 bg-orange-400/10 px-2 text-orange-400 text-xs">
              {base.rerankModelMeta.name}
            </div>
          )}
          {base.fileProcessorId && (
            <div className="rounded-3xs border border-teal-500/20 bg-teal-500/10 px-2 text-teal-500 text-xs">
              {base.fileProcessorId}
            </div>
          )}
        </div>
        <div className="flex flex-row items-center gap-2">
          {hasOrphans && (
            <>
              <Button
                className="h-8 rounded-2xs"
                variant="secondary"
                size="sm"
                onClick={handleRecover}
                disabled={isRecovering || isIgnoring}>
                <History size={14} className={isRecovering ? 'animate-spin' : ''} />
                {t('knowledge.recover_orphans', { count: orphanCount })}
              </Button>
              <Button
                className="h-8 rounded-2xs"
                variant="secondary"
                size="sm"
                onClick={handleIgnore}
                disabled={isRecovering || isIgnoring}>
                {t('knowledge.ignore_orphans')}
              </Button>
            </>
          )}

          <Button className="hover:opacity-70" size="icon-sm" variant="ghost" onClick={() => setSearchDialogOpen(true)}>
            <Search size={18} />
          </Button>
        </div>
      </div>

      <Tabs
        value={activeKey}
        onValueChange={(value) => setActiveKey(value as TabKey)}
        variant="line"
        className="flex-1">
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

      <EditKnowledgeBaseDialog base={base} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      <KnowledgeSearchDialog base={base} open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
    </div>
  )
}

export default KnowledgeContent
