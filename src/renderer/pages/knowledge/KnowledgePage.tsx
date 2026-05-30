import { KnowledgePageProvider, useKnowledgePage } from './KnowledgePageProvider'
import KnowledgePageDetailSection from './sections/KnowledgePageDetailSection'
import KnowledgePageDialogSection from './sections/KnowledgePageDialogSection'
import KnowledgePageEmptyStateSection from './sections/KnowledgePageEmptyStateSection'
import KnowledgePageNavigatorSection from './sections/KnowledgePageNavigatorSection'
import KnowledgePageShell from './sections/KnowledgePageShell'

const KnowledgePageContent = () => {
  const { selectedBase } = useKnowledgePage()

  return (
    <KnowledgePageShell>
      <KnowledgePageNavigatorSection />
      {selectedBase ? <KnowledgePageDetailSection /> : <KnowledgePageEmptyStateSection />}
    </KnowledgePageShell>
  )
}

const KnowledgePage = () => {
  return (
    <KnowledgePageProvider>
      <KnowledgePageContent />
      <KnowledgePageDialogSection />
    </KnowledgePageProvider>
  )
}

export default KnowledgePage
