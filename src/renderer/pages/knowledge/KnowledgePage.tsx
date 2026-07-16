import { useTranslation } from 'react-i18next'

import { KnowledgePageProvider, useKnowledgePage } from './KnowledgePageProvider'
import KnowledgePageDetailSection from './sections/KnowledgePageDetailSection'
import KnowledgePageDialogSection from './sections/KnowledgePageDialogSection'
import KnowledgePageEmptyStateSection from './sections/KnowledgePageEmptyStateSection'
import KnowledgePageNavigatorSection from './sections/KnowledgePageNavigatorSection'
import KnowledgePageShell from './sections/KnowledgePageShell'

const KnowledgePageContent = () => {
  const { t } = useTranslation()
  const { bases, isLoading, selectedBase } = useKnowledgePage()

  // The two-pane shell stays mounted even with zero bases — the navigator keeps
  // the permanent "+" create entry, and the right pane shows the empty state,
  // matching the Files/Notes layout.
  return (
    <KnowledgePageShell>
      <KnowledgePageNavigatorSection />
      {selectedBase ? (
        <KnowledgePageDetailSection />
      ) : !isLoading && bases.length === 0 ? (
        <KnowledgePageEmptyStateSection />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground text-sm">
          {t('common.loading')}
        </main>
      )}
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
