import { EmptyState } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

/**
 * Right-pane empty state when no knowledge bases exist. Creation lives in the
 * navigator's permanent "+" entry, so this stays minimal — illustration + title,
 * matching the Files/Notes empty states.
 */
const KnowledgePageEmptyStateSection = () => {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <EmptyState title={t('knowledge.empty')} />
    </main>
  )
}

export default KnowledgePageEmptyStateSection
