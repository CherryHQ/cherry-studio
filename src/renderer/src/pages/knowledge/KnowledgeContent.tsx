import { Button, CustomTag, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useKnowledgeBase, useKnowledgeItems } from '@renderer/data/hooks/useKnowledges'
import { History, PlusIcon, Search, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './components/KnowledgeSearchDialog'
import { useKnowledgeAddActions } from './hooks/useKnowledgeAddActions'
import { useKnowledgeQueueActions } from './hooks/useKnowledgeQueueActions'
import { type TabKey, useKnowledgeTabs } from './hooks/useKnowledgeTabs'
interface KnowledgeContentProps {
  selectedBaseId: string
}

const KnowledgeContent: FC<KnowledgeContentProps> = ({ selectedBaseId }) => {
  const { t } = useTranslation()
  const { base } = useKnowledgeBase(selectedBaseId)
  const { items } = useKnowledgeItems(selectedBaseId)

  const { hasOrphans, orphanCount, handleRecover, handleIgnore, isRecovering, isIgnoring } =
    useKnowledgeQueueActions(selectedBaseId)
  const { activeKey, setActiveKey, tabItems } = useKnowledgeTabs({
    base: base ?? null,
    items
  })

  // Add actions for the current tab
  const addActions = useKnowledgeAddActions({ base: base ?? null })
  const currentAction = addActions[activeKey as TabKey]
  const currentTab = tabItems.find((t) => t.key === activeKey)

  // Edit dialog state (independent from sidebar's edit dialog)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  // Search dialog state
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
          {base.preprocessProviderId && (
            <div className="rounded-3xs border border-teal-500/20 bg-teal-500/10 px-2 text-teal-500 text-xs">
              {base.preprocessProviderId}
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

      <Tabs value={activeKey} onValueChange={(v) => setActiveKey(v as TabKey)} variant="line" className="flex-1">
        <div className="mx-4 flex h-12 items-center justify-between border-b-0 bg-transparent p-0">
          <TabsList className="h-full justify-start gap-1 bg-transparent p-0">
            {tabItems.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="gap-1.5 px-3 py-3 text-[13px]">
                {item.icon}
                <span>{item.title}</span>
                <div></div>
                <CustomTag size={10} color={item.items.length > 0 ? '#00b96b' : '#cccccc'}>
                  {item.items.length}
                </CustomTag>
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            className="h-8 rounded-2xs"
            size="sm"
            variant="outline"
            onClick={currentAction?.handler}
            disabled={currentAction?.disabled || currentAction?.loading}>
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

      {/* Edit Dialog */}
      <EditKnowledgeBaseDialog base={base} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      {/* Search Dialog */}
      <KnowledgeSearchDialog base={base} open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
    </div>
  )
}

export default KnowledgeContent
