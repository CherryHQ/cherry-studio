import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { normalizeKnowledgeError } from '@renderer/pages/knowledge/utils'
import { ChevronDown, ChevronUp, Copy, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RecallResultItem } from './types'
import { formatRecallPercent } from './utils'

const logger = loggerService.withContext('RecallResultCard')

interface RecallResultCardProps {
  item: RecallResultItem
  index: number
}

const RecallResultCard = ({ item, index }: RecallResultCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const scoreLabel =
    item.scoreKind === 'relevance'
      ? t('knowledge.recall.result_relevance', { score: formatRecallPercent(item.score) })
      : t('knowledge.recall.result_rank', { rank: item.rank })

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(item.plainText)
    } catch (error) {
      const normalizedError = normalizeKnowledgeError(error)
      logger.error('Failed to copy recall result content', normalizedError, {
        resultId: item.id,
        sourceName: item.sourceName,
        chunkIndex: item.chunkIndex
      })
      window.toast.error(t('message.copy.failed'))
    }
  }

  return (
    <div className="group/chunk rounded-md border border-border-subtle bg-background transition-all hover:border-border-hover">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-background-subtle text-foreground-muted text-xs leading-4">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <FileText className="size-3.5 shrink-0 text-foreground-muted" />
          <span className="truncate text-foreground-muted text-xs leading-4">{item.sourceName}</span>
          <span className="shrink-0 text-foreground-muted text-xs leading-3">#{item.chunkIndex}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-16 text-right text-foreground-muted text-xs tabular-nums leading-4">{scoreLabel}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('knowledge.recall.copy')}
          className="size-5 min-h-5 shrink-0 rounded p-0 text-foreground-muted opacity-0 shadow-none transition-all hover:bg-accent hover:text-foreground group-hover/chunk:opacity-100"
          onClick={() => void copyContent()}>
          <Copy className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={t(isExpanded ? 'knowledge.recall.collapse' : 'knowledge.recall.expand')}
          className="size-5 min-h-5 shrink-0 rounded p-0 text-foreground-muted shadow-none transition-all hover:bg-accent hover:text-foreground"
          onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>
      </div>
      <div className="overflow-hidden px-3 pb-3">
        <p className={`text-foreground-secondary text-sm leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
          {item.content}
        </p>
      </div>
    </div>
  )
}

export default RecallResultCard
