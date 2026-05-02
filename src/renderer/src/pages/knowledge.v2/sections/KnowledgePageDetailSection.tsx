import DetailHeader from '../components/DetailHeader'
import DetailTabs from '../components/DetailTabs'
import { useDeleteKnowledgeItem, useReindexKnowledgeItem } from '../hooks'
import { useKnowledgePage } from '../KnowledgePageProvider'
import DataSourcePanel from '../panels/dataSource/DataSourcePanel'
import KnowledgeItemChunkDetailPanel from '../panels/dataSource/KnowledgeItemChunkDetailPanel'
import RagConfigPanel from '../panels/ragConfig/RagConfigPanel'
import RecallTestPanel from '../panels/recallTest/RecallTestPanel'

const KnowledgePageDetailSection = () => {
  const {
    activeTab,
    selectedBase,
    selectedBaseId,
    selectedBaseItems,
    selectedItemId,
    isItemsLoading,
    setActiveTab,
    openItemChunks,
    closeItemChunks,
    openAddSourceDialog,
    openRenameBaseDialog,
    openRestoreBaseDialog,
    deleteBase
  } = useKnowledgePage()
  const { deleteItem } = useDeleteKnowledgeItem(selectedBaseId)
  const { reindexItem } = useReindexKnowledgeItem(selectedBaseId)

  if (!selectedBase) {
    return null
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <DetailHeader
        base={selectedBase}
        itemCount={selectedBaseItems.length}
        onRenameBase={openRenameBaseDialog}
        onRestoreBase={openRestoreBaseDialog}
        onDeleteBase={deleteBase}
      />
      <DetailTabs activeTab={activeTab} dataSourceCount={selectedBaseItems.length} onChange={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'data' && selectedItemId ? (
          <KnowledgeItemChunkDetailPanel baseId={selectedBaseId} itemId={selectedItemId} onBack={closeItemChunks} />
        ) : null}
        {activeTab === 'data' && !selectedItemId ? (
          <DataSourcePanel
            items={selectedBaseItems}
            isLoading={isItemsLoading}
            onAdd={openAddSourceDialog}
            onItemClick={openItemChunks}
            onDelete={deleteItem}
            onReindex={reindexItem}
          />
        ) : null}
        {activeTab === 'rag' ? <RagConfigPanel base={selectedBase} onRestoreBase={openRestoreBaseDialog} /> : null}
        {activeTab === 'recall' ? <RecallTestPanel baseId={selectedBaseId} /> : null}
      </div>
    </main>
  )
}

export default KnowledgePageDetailSection
