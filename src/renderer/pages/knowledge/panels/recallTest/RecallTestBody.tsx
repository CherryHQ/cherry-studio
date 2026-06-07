import { EmptyState, HStack, VStack } from '@cherrystudio/ui'
import { Clock, LoaderCircle, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import RecallResultCard from './RecallResultCard'
import { useRecallTest } from './RecallTestProvider'
import { formatRecallPercent, formatRecallScore } from './utils'

const RecallResultSummary = () => {
  const { t } = useTranslation()
  const {
    state: { results, duration, topScore, scoreKind }
  } = useRecallTest()

  return (
    <HStack
      gap={4}
      justify="between"
      className="border-border-muted border-b px-4 py-3 text-foreground-muted text-xs leading-4">
      <HStack gap={2}>
        <span className="flex items-center gap-0.5">
          <Sparkles className="size-3" />
          {t('knowledge.recall.result_count', { count: results.length })}
        </span>
        <span className="flex items-center gap-0.5">
          <Clock className="size-3" />
          {t('knowledge.recall.duration', { duration })}
        </span>
        <span>
          {scoreKind === 'ranking'
            ? t('knowledge.recall.ranking_only')
            : t('knowledge.recall.top_score', {
                score: results.length === 0 ? formatRecallScore(topScore) : formatRecallPercent(topScore)
              })}
        </span>
      </HStack>
    </HStack>
  )
}

const RecallResults = () => {
  const {
    state: { results }
  } = useRecallTest()

  return (
    <div className="min-h-0 overflow-y-auto px-6 py-5 [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-border-subtle bg-card">
        <RecallResultSummary />
        <VStack gap={2} className="p-3">
          {results.map((item, index) => (
            <RecallResultCard key={item.id} item={item} index={index} />
          ))}
        </VStack>
      </div>
    </div>
  )
}

const RecallEmptyState = () => {
  const { t } = useTranslation()

  return (
    <div className="h-full min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden">
      <EmptyState
        preset="no-result"
        title={t('knowledge.recall.empty_title')}
        description={t('knowledge.recall.empty_description')}
        className="h-full"
      />
    </div>
  )
}

const RecallSearchingState = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center py-12 text-center text-foreground-muted">
      <LoaderCircle className="size-5.5 animate-spin text-primary" />
      <p className="mt-2 text-sm leading-5">{t('knowledge.recall.searching')}</p>
    </div>
  )
}

const RecallTestBody = () => {
  const {
    state: { isSearching, hasSearched }
  } = useRecallTest()

  if (isSearching) {
    return (
      <div className="h-full min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <RecallSearchingState />
      </div>
    )
  }

  if (hasSearched) {
    return <RecallResults />
  }

  return <RecallEmptyState />
}

export default RecallTestBody
