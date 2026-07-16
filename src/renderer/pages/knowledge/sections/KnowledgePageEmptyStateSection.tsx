import { EmptyState } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'

const KnowledgePageEmptyStateSection = () => {
  const { t } = useTranslation()
  const { openCreateBaseDialog } = useKnowledgePage()

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <EmptyState
        preset="no-knowledge"
        title={t('knowledge.empty')}
        description={t('knowledge.empty_description')}
        actionLabel={t('knowledge.empty_action')}
        onAction={() => openCreateBaseDialog()}
      />
    </main>
  )
}

export default KnowledgePageEmptyStateSection
