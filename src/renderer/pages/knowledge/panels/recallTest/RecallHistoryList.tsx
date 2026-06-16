import { Button } from '@cherrystudio/ui'
import { History, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useRecallTest } from './RecallTestProvider'

const RecallHistoryList = () => {
  const { t } = useTranslation()
  const {
    state: { historyItems },
    actions: { selectHistory, removeHistory, clearHistory }
  } = useRecallTest()

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between px-2 py-0.5">
        <span className="text-foreground-muted text-xs leading-4">{t('knowledge.recall.history_title')}</span>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-0 rounded-none p-0 text-foreground-muted text-xs leading-4 shadow-none transition-colors hover:bg-transparent hover:text-red-500"
          onClick={clearHistory}>
          {t('knowledge.recall.history_clear')}
        </Button>
      </div>

      {historyItems.map((item) => (
        <div
          key={item.id}
          className="group/hist flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent"
          onClick={() => selectHistory(item)}>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <History className="size-3.5 shrink-0 text-foreground-muted" />
            <span className="min-w-0 flex-1 truncate text-foreground text-sm leading-5">{item.query}</span>
          </button>
          <button
            type="button"
            aria-label={t('knowledge.recall.history_remove')}
            className="shrink-0 cursor-default text-foreground-muted opacity-0 transition-all hover:text-destructive group-hover/hist:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              removeHistory(item.id)
            }}>
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

export default RecallHistoryList
