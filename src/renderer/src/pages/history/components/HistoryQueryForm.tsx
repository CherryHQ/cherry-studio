import { Input } from '@cherrystudio/ui'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HistoryQueryFormProps {
  resultCount: number
  searchText: string
  onSearchTextChange: (value: string) => void
}

const HistoryQueryForm = ({ resultCount, searchText, onSearchTextChange }: HistoryQueryFormProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 bg-background px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="font-medium text-foreground text-sm leading-5">
          {t('history.v2.resultCount', '{{count}} 条结果', { count: resultCount })}
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
            className="h-8 rounded-md border-border-subtle bg-background pl-8 text-xs shadow-none"
            placeholder={t('history.v2.searchTopic', '搜索话题...')}
            aria-label={t('history.v2.searchTopic', '搜索话题...')}
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export default HistoryQueryForm
