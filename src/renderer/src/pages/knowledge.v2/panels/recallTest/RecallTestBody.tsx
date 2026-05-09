import { Clock, LoaderCircle, Search, Sparkles } from 'lucide-react'
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
    <div className="mt-1.5 flex items-center gap-2.5 text-muted-foreground/35 text-xs leading-4">
      <span className="flex items-center gap-0.5">
        <Sparkles className="size-2" />
        {t('knowledge_v2.recall.result_count', { count: results.length })}
      </span>
      <span className="flex items-center gap-0.5">
        <Clock className="size-2" />
        {t('knowledge_v2.recall.duration', { duration })}
      </span>
      <span>
        {scoreKind === 'ranking'
          ? t('knowledge_v2.recall.ranking_only')
          : t('knowledge_v2.recall.top_score', {
              score: results.length === 0 ? formatRecallScore(topScore) : formatRecallPercent(topScore)
            })}
      </span>
    </div>
  )
}

const RecallResults = () => {
  const {
    state: { results }
  } = useRecallTest()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden">
      <div className="space-y-1.5">
        <RecallResultSummary />
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
    <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
      <div className="flex min-h-full flex-col items-center justify-center py-12 text-center text-muted-foreground/25">
        <Search className="size-5.5" />
        <p className="mt-1 text-sm leading-5">{t('knowledge_v2.recall.empty_title')}</p>
        <p className="mt-0.5 text-xs leading-4">{t('knowledge_v2.recall.empty_description')}</p>
      </div>
    </div>
  )
}

const RecallSearchingState = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full flex-col items-center justify-center py-12 text-center text-muted-foreground/35">
      <LoaderCircle className="size-5.5 animate-spin text-primary" />
      <p className="mt-2 text-sm leading-5">{t('knowledge_v2.recall.searching')}</p>
    </div>
  )
}

const RecallTestBody = () => {
  const {
    state: { isSearching, hasSearched }
  } = useRecallTest()

  if (isSearching) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
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
