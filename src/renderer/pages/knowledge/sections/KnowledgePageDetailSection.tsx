import { ArrowLeft } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, PageSidePanel } from '@cherrystudio/ui'
import { FilePreview } from '@renderer/components/FilePreview'
import { useDeleteKnowledgeItem, useKnowledgeItems, useReindexKnowledgeItem } from '@renderer/hooks/useKnowledgeItems'
import type { KnowledgeItemSort, KnowledgeItemSortBy } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

import DetailHeader from '../components/DetailHeader'
import { useKnowledgePage } from '../KnowledgePageProvider'
import DataSourcePanel from '../panels/dataSource/DataSourcePanel'
import { nextKnowledgeItemSort } from '../utils/itemSort'

// Item detail views are loaded when an item is opened, not with the page.
const KnowledgeItemChunkDetailPanel = lazy(() => import('../panels/dataSource/KnowledgeItemChunkDetailPanel'))
const KnowledgeItemNoteContentPanel = lazy(() => import('../panels/dataSource/KnowledgeItemNoteContentPanel'))

const RagConfigPanel = lazy(() => import('../panels/ragConfig/RagConfigPanel'))
const RecallTestPanel = lazy(() => import('../panels/recallTest/RecallTestPanel'))

const KnowledgePageDetailSection = () => {
  const { t } = useTranslation()
  const {
    selectedBase,
    selectedBaseId,
    selectedItemId,
    selectedItemView,
    filePreview,
    baseNavigationVersion,
    isRagConfigDrawerOpen,
    isRecallTestDrawerOpen,
    openItemChunks,
    openItemContent,
    closeItemChunks,
    openFilePreview,
    closeFilePreview,
    openAddSourceDialog,
    openRagConfigDrawer,
    openRecallTestDrawer,
    handleRagConfigDrawerOpenChange,
    handleRecallTestDrawerOpenChange,
    openRestoreBaseDialog
  } = useKnowledgePage()

  const [sortState, setSortState] = useState<{ baseId: string; sort: KnowledgeItemSort | null }>(() => ({
    baseId: selectedBaseId,
    sort: null
  }))
  const itemSort = sortState.baseId === selectedBaseId ? sortState.sort : null
  useEffect(() => {
    setSortState((previous) => (previous.baseId === selectedBaseId ? previous : { baseId: selectedBaseId, sort: null }))
  }, [selectedBaseId])
  const changeItemSort = useCallback(
    (sortBy: KnowledgeItemSortBy) => {
      setSortState((previous) => ({
        baseId: selectedBaseId,
        sort: nextKnowledgeItemSort(previous.baseId === selectedBaseId ? previous.sort : null, sortBy)
      }))
    },
    [selectedBaseId]
  )

  // The stack holds directory or opt-in URL owners; groupId lists their direct children.
  const [groupStack, setGroupStack] = useState<KnowledgeItemOf<'directory' | 'url'>[]>([])
  const currentGroup = groupStack.at(-1) ?? null

  // Every base selection starts from that base's root, including re-selecting the current base.
  useEffect(() => {
    setGroupStack([])
  }, [baseNavigationVersion])

  const drillIntoGroup = useCallback((item: KnowledgeItemOf<'directory' | 'url'>) => {
    setGroupStack((prev) => [...prev, item])
  }, [])
  const navigateUp = useCallback(() => {
    setGroupStack((prev) => prev.slice(0, -1))
  }, [])

  const {
    items: selectedBaseItems,
    total: selectedBaseItemsTotal,
    isLoading: isItemsLoading,
    hasMore: hasMoreItems,
    isLoadingMore: isLoadingMoreItems,
    loadMore: loadMoreItems
  } = useKnowledgeItems(selectedBaseId, currentGroup?.id ?? null, itemSort)
  const { deleteItem, deleteItems } = useDeleteKnowledgeItem(selectedBaseId)
  const { reindexItem, reindexItems } = useReindexKnowledgeItem(selectedBaseId)

  if (!selectedBase) {
    return null
  }

  return (
    <main data-ui="knowledge.content" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!selectedItemId && !filePreview ? (
        <DetailHeader
          base={selectedBase}
          onOpenRagConfig={openRagConfigDrawer}
          onOpenRecallTest={openRecallTestDrawer}
          onRebuild={() => openRestoreBaseDialog(selectedBase)}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedItemId ? (
          <Suspense fallback={null}>
            {selectedItemView === 'content' ? (
              <KnowledgeItemNoteContentPanel itemId={selectedItemId} onBack={closeItemChunks} />
            ) : (
              <KnowledgeItemChunkDetailPanel baseId={selectedBaseId} itemId={selectedItemId} onBack={closeItemChunks} />
            )}
          </Suspense>
        ) : filePreview ? (
          <section
            aria-label={filePreview.fileName}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <FilePreview
              filePath={filePreview.filePath}
              header={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.back')}
                    className="size-6 min-h-6 min-w-6 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                    onClick={closeFilePreview}>
                    <ArrowLeft className="size-3.5" />
                  </Button>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{filePreview.fileName}</span>
                </>
              }
            />
          </section>
        ) : (
          <DataSourcePanel
            sort={itemSort}
            onSortChange={changeItemSort}
            embeddingModelId={selectedBase.embeddingModelId}
            items={selectedBaseItems}
            total={selectedBaseItemsTotal}
            isLoading={isItemsLoading}
            hasMore={hasMoreItems}
            isLoadingMore={isLoadingMoreItems}
            onLoadMore={loadMoreItems}
            updatedAt={selectedBase.updatedAt}
            onAdd={openAddSourceDialog}
            onPreviewFile={openFilePreview}
            onItemClick={openItemChunks}
            onViewNoteContent={openItemContent}
            onDrillIntoGroup={drillIntoGroup}
            currentGroup={currentGroup}
            onNavigateUp={navigateUp}
            onDelete={deleteItem}
            onDeleteItems={deleteItems}
            onReindex={reindexItem}
            onReindexItems={reindexItems}
          />
        )}
      </div>

      <PageSidePanel
        open={isRagConfigDrawerOpen}
        onClose={() => handleRagConfigDrawerOpenChange(false)}
        title={t('knowledge.tabs.rag_config')}
        closeLabel={t('common.close')}
        bodyClassName="px-0 py-0">
        {isRagConfigDrawerOpen ? (
          <Suspense fallback={null}>
            <RagConfigPanel
              base={selectedBase}
              itemCount={isItemsLoading ? undefined : selectedBaseItemsTotal}
              onRestoreBase={openRestoreBaseDialog}
            />
          </Suspense>
        ) : null}
      </PageSidePanel>

      <PageSidePanel
        open={isRecallTestDrawerOpen}
        onClose={() => handleRecallTestDrawerOpenChange(false)}
        title={t('knowledge.tabs.recall_test')}
        closeLabel={t('common.close')}
        bodyClassName="px-0 py-0">
        {isRecallTestDrawerOpen ? (
          <Suspense fallback={null}>
            <RecallTestPanel baseId={selectedBaseId} />
          </Suspense>
        ) : null}
      </PageSidePanel>
    </main>
  )
}

export default KnowledgePageDetailSection
