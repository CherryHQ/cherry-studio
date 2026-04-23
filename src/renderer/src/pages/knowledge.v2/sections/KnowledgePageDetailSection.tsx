import DetailHeader from '../components/DetailHeader'
import DetailTabs from '../components/DetailTabs'
import { useKnowledgePage } from '../KnowledgePageProvider'
import DataSourcePanel from '../panels/dataSource/DataSourcePanel'
import RagConfigPanel from '../panels/ragConfig/RagConfigPanel'
import RecallTestPanel from '../panels/recallTest/RecallTestPanel'

const KnowledgePageDetailSection = () => {
  const {
    activeTab,
    selectedBase,
    selectedBaseItems,
    isItemsLoading,
    setActiveTab,
    openAddSourceDialog,
    openRenameBaseDialog,
    deleteBase
  } = useKnowledgePage()

  if (!selectedBase) {
    return null
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <DetailHeader base={selectedBase} onRenameBase={openRenameBaseDialog} onDeleteBase={deleteBase} />
      <DetailTabs activeTab={activeTab} dataSourceCount={selectedBaseItems.length} onChange={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'data' ? (
          <DataSourcePanel items={selectedBaseItems} isLoading={isItemsLoading} onAdd={openAddSourceDialog} />
        ) : null}
        {activeTab === 'rag' ? <RagConfigPanel base={selectedBase} /> : null}
        {activeTab === 'recall' ? <RecallTestPanel /> : null}
      </div>
    </main>
  )
}

export default KnowledgePageDetailSection
