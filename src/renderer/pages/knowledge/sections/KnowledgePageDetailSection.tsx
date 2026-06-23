import { PageSidePanel } from '@cherrystudio/ui'
import { useDeleteKnowledgeItem, useKnowledgeItems, useReindexKnowledgeItem } from '@renderer/hooks/useKnowledgeItems'
import { useTranslation } from 'react-i18next'

import DetailHeader from '../components/DetailHeader'
import { useKnowledgePage } from '../KnowledgePageProvider'
import DataSourcePanel from '../panels/dataSource/DataSourcePanel'
import KnowledgeItemChunkDetailPanel from '../panels/dataSource/KnowledgeItemChunkDetailPanel'
import RagConfigPanel from '../panels/ragConfig/RagConfigPanel'
import RecallTestPanel from '../panels/recallTest/RecallTestPanel'

const KnowledgePageDetailSection = () => {
  const { t } = useTranslation()
  const {
    selectedBase,
    selectedBaseId,
    selectedItemId,
    isRagConfigDrawerOpen,
    isRecallTestDrawerOpen,
    openItemChunks,
    closeItemChunks,
    openAddSourceDialog,
    openRagConfigDrawer,
    openRecallTestDrawer,
    handleRagConfigDrawerOpenChange,
    handleRecallTestDrawerOpenChange,
    openRenameBaseDialog,
    openRestoreBaseDialog,
    deleteBase
  } = useKnowledgePage()
  const {
    items: selectedBaseItems,
    total: selectedBaseItemsTotal,
    isLoading: isItemsLoading,
    hasMore: hasMoreItems,
    isLoadingMore: isLoadingMoreItems,
    loadMore: loadMoreItems
  } = useKnowledgeItems(selectedBaseId)
  const { deleteItem } = useDeleteKnowledgeItem(selectedBaseId)
  const { reindexItem } = useReindexKnowledgeItem(selectedBaseId)

  if (!selectedBase) {
    return null
  }

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <DetailHeader
        base={selectedBase}
        onOpenRagConfig={openRagConfigDrawer}
        onOpenRecallTest={openRecallTestDrawer}
        onRenameBase={openRenameBaseDialog}
        onDeleteBase={deleteBase}
      />

      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        {selectedItemId ? (
          <KnowledgeItemChunkDetailPanel baseId={selectedBaseId} itemId={selectedItemId} onBack={closeItemChunks} />
        ) : (
          <DataSourcePanel
            items={selectedBaseItems}
            total={selectedBaseItemsTotal}
            isLoading={isItemsLoading}
            hasMore={hasMoreItems}
            isLoadingMore={isLoadingMoreItems}
            onLoadMore={loadMoreItems}
            updatedAt={selectedBase.updatedAt}
            onAdd={openAddSourceDialog}
            onItemClick={openItemChunks}
            onDelete={deleteItem}
            onReindex={reindexItem}
          />
        )}
      </div>

      <PageSidePanel
        open={isRagConfigDrawerOpen}
        onClose={() => handleRagConfigDrawerOpenChange(false)}
        title={t('knowledge.tabs.rag_config')}
        closeLabel={t('common.close')}
        bodyClassName="px-0 py-0">
        <RagConfigPanel base={selectedBase} onRestoreBase={openRestoreBaseDialog} />
      </PageSidePanel>

      <PageSidePanel
        open={isRecallTestDrawerOpen}
        onClose={() => handleRecallTestDrawerOpenChange(false)}
        title={t('knowledge.tabs.recall_test')}
        closeLabel={t('common.close')}
        bodyClassName="px-0 py-0">
        <RecallTestPanel baseId={selectedBaseId} />
      </PageSidePanel>
    </main>
  )
}

export default KnowledgePageDetailSection
