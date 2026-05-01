import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp, Copy, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RecallResultItem } from './types'
import { formatRecallScore } from './utils'

interface RecallResultCardProps {
  item: RecallResultItem
  index: number
}

const RecallResultCard = ({ item, index }: RecallResultCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  const copyContent = async () => {
    await navigator.clipboard?.writeText(item.plainText).catch(() => undefined)
  }

  return (
    <div className="group/chunk rounded-lg border border-border/20 bg-muted/[0.03] transition-all hover:border-border/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/50 text-[0.5625rem] text-muted-foreground/50 leading-3.375">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <FileText className="size-2.5 shrink-0 text-muted-foreground/35" />
          <span className="truncate text-[0.625rem] text-muted-foreground/50 leading-3.75">{item.sourceName}</span>
          <span className="shrink-0 text-[0.5rem] text-muted-foreground/20 leading-3">#{item.chunkIndex}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* <div className="h-0.75 w-12 overflow-hidden rounded-full bg-border/25">
            <div
              className={`h-full rounded-full transition-all duration-500 ${item.scoreColor}`}
              style={{ width: `${item.scorePercent}%` }}
            />
          </div> */}
          <span className="w-10 text-right text-[0.5625rem] text-muted-foreground/50 tabular-nums leading-3.375">
            {formatRecallScore(item.score)}
          </span>
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
        <p className={`text-[0.6875rem] text-foreground/75 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
          {item.content}
        </p>
      </div>
    </div>
  )
}

export default RecallResultCard
