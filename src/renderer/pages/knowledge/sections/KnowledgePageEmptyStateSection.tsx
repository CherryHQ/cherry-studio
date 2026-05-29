import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'

const KnowledgePageEmptyStateSection = () => {
  const { t } = useTranslation()
  const { isLoading } = useKnowledgePage()

  return (
    <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground text-sm">
      {isLoading ? t('common.loading') : t('knowledge.empty')}
    </main>
  )
}

export default KnowledgePageEmptyStateSection
