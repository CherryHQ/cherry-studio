import { Clock, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import RecallResultCard from './RecallResultCard'
import { useRecallTest } from './RecallTestProvider'
import { formatRecallScore } from './utils'

const RecallResultSummary = () => {
  const { t } = useTranslation()
  const {
    state: { results, duration, topScore }
  } = useRecallTest()

  return (
    <div className="mt-1.5 flex items-center gap-2.5 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
      <span className="flex items-center gap-0.5">
        <Sparkles className="size-2" />
        {t('knowledge_v2.recall.result_count', { count: results.length })}
      </span>
      <span className="flex items-center gap-0.5">
        <Clock className="size-2" />
        {t('knowledge_v2.recall.duration', { duration })}
      </span>
      <span>{t('knowledge_v2.recall.top_score', { score: formatRecallScore(topScore) })}</span>
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
        <p className="mt-1 text-[0.6875rem] leading-4.125">{t('knowledge_v2.recall.empty_title')}</p>
        <p className="mt-0.5 text-[0.5625rem] leading-3.375">{t('knowledge_v2.recall.empty_description')}</p>
      </div>
    </div>
  )
}

const RecallSearchingState = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full flex-col items-center justify-center py-12 text-center text-muted-foreground/35">
      <LoaderCircle className="size-5.5 animate-spin text-cherry-primary" />
      <p className="mt-2 text-[0.6875rem] leading-4.125">{t('knowledge_v2.recall.searching')}</p>
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
