import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp, Copy, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RecallResultItem } from './types'
import { formatRecallPercent } from './utils'

interface RecallResultCardProps {
  item: RecallResultItem
  index: number
}

const RecallResultCard = ({ item, index }: RecallResultCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const scoreLabel =
    item.scoreKind === 'relevance'
      ? t('knowledge_v2.recall.result_relevance', { score: formatRecallPercent(item.score) })
      : t('knowledge_v2.recall.result_rank', { rank: item.rank })

  const copyContent = async () => {
    await navigator.clipboard?.writeText(item.plainText).catch(() => undefined)
  }

  return (
    <div className="group/chunk rounded-lg border border-border/20 bg-muted/[0.03] transition-all hover:border-border/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/50 text-muted-foreground/50 text-xs leading-4">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <FileText className="size-2.5 shrink-0 text-muted-foreground/35" />
          <span className="truncate text-muted-foreground/50 text-sm leading-4">{item.sourceName}</span>
          <span className="shrink-0 text-muted-foreground/20 text-xs leading-3">#{item.chunkIndex}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* <div className="h-0.75 w-12 overflow-hidden rounded-full bg-border/25">
            <div
              className={`h-full rounded-full transition-all duration-500 ${item.scoreColor}`}
              style={{ width: `${item.scorePercent}%` }}
            />
          </div> */}
          <span className="w-16 text-right text-muted-foreground/50 text-xs tabular-nums leading-4">{scoreLabel}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('knowledge_v2.recall.copy')}
          className="size-4 min-h-4 shrink-0 rounded p-0 text-muted-foreground/20 opacity-0 shadow-none transition-all hover:bg-accent hover:text-foreground group-hover/chunk:opacity-100"
          onClick={() => void copyContent()}>
          <Copy className="size-2" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={t(isExpanded ? 'knowledge_v2.recall.collapse' : 'knowledge_v2.recall.expand')}
          className="size-4 min-h-4 shrink-0 rounded p-0 text-muted-foreground/20 shadow-none transition-all hover:bg-accent hover:text-foreground"
          onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />}
        </Button>
      </div>
      <div className="overflow-hidden px-2.5 pb-2">
        <p className={`text-foreground/75 text-sm leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
          {item.content}
        </p>
      </div>
    </div>
  )
}

export default RecallResultCard
