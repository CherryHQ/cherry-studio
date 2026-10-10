import { Clock, LoaderCircle, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import RecallResultCard from './RecallResultCard'
import { useRecallResult } from './RecallTestProvider'
import { formatRecallPercent, formatRecallScore } from './utils'

const RecallResultSummary = () => {
  const { t } = useTranslation()
  const {
    state: { results, duration, topScore, scoreKind }
  } = useRecallResult()

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3 text-xs leading-4 text-foreground-tertiary">
      <div className="flex items-center gap-2.5">
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
      </div>
    </div>
  )
}

const RecallResults = () => {
  const {
    state: { results }
  } = useRecallResult()

  return (
    <div className="mx-auto h-full w-full max-w-3xl min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border-subtle bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <RecallResultSummary />
      <div className="min-w-0 space-y-2 p-3">
        {results.map((item, index) => (
          <RecallResultCard key={item.id} item={item} index={index} />
        ))}
      </div>
    </div>
  )
}

const RecallEmptyState = () => {
  const { t } = useTranslation()

  return (
    <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden">
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
    <div className="flex h-full min-h-full flex-col items-center justify-center py-12 text-center text-foreground-tertiary">
      <LoaderCircle className="size-5.5 animate-spin text-primary" />
      <p className="mt-2 text-sm leading-5">{t('knowledge.recall.searching')}</p>
    </div>
  )
}

const RecallTestBody = () => {
  const {
    state: { isSearching, hasSearched }
  } = useRecallResult()

  if (isSearching) {
    return (
      <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden">
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
