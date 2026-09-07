import { EmptyState } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'

/**
 * Full-screen empty page shown instead of the two-pane shell while no knowledge
 * base exists. It replaces the navigator, so it has to carry creation itself:
 * the book illustration, the invitation, and the create action.
 */
const KnowledgePageEmptyStateSection = () => {
  const { t } = useTranslation()
  const { openCreateBaseDialog } = useKnowledgePage()

  return (
    <main data-ui="knowledge.view" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <EmptyState
        illustration="book"
        title={t('knowledge.empty')}
        description={t('knowledge.empty_description')}
        actionLabel={t('knowledge.empty_action')}
        onAction={() => openCreateBaseDialog()}
      />
    </main>
  )
}

export default KnowledgePageEmptyStateSection
