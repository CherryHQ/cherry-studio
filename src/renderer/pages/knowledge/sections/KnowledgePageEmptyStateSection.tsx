import { EmptyState } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

/**
 * Right-pane empty state when no knowledge bases exist. The navigator names the
 * list state ("no knowledge bases yet") and owns creation via its "+" entry, so
 * this pane carries the invitation instead: the book illustration plus
 * "build up your knowledge with AI".
 */
const KnowledgePageEmptyStateSection = () => {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <EmptyState illustration="book" title={t('knowledge.empty_description')} />
    </main>
  )
}

export default KnowledgePageEmptyStateSection
