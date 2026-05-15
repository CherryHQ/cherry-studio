import { Input } from '@cherrystudio/ui'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HistoryQueryFormProps {
  mode: HistoryRecordsMode
  resultCount: number
  searchText: string
  onSearchTextChange: (value: string) => void
}

const HistoryQueryForm = ({ mode, resultCount, searchText, onSearchTextChange }: HistoryQueryFormProps) => {
  const { t } = useTranslation()
  const searchPlaceholder =
    mode === 'assistant'
      ? t('history.records.searchTopic', '搜索话题...')
      : t('history.records.searchSession', '搜索会话...')

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 bg-card px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="font-medium text-foreground text-sm leading-5">
          {t('history.records.resultCount', '{{count}} 条结果', { count: resultCount })}
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <div className="relative w-[236px] max-w-[26vw]">
          <Search
            size={14}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-foreground-muted"
          />
          <Input
            value={searchText}
            className="h-8 rounded-md border-border-subtle bg-card pl-8 text-xs shadow-none"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export default HistoryQueryForm
