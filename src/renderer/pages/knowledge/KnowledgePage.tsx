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

  // No knowledge bases yet → a dedicated full-screen empty page (no navigator) that
  // guides the user to create their first base. The create dialog still mounts via
  // KnowledgePageDialogSection below.
  if (!isLoading && bases.length === 0) {
    return <KnowledgePageEmptyStateSection />
  }

  return (
    <KnowledgePageShell>
      <KnowledgePageNavigatorSection />
      {selectedBase ? (
        <KnowledgePageDetailSection />
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
