import { Button, Input, Scrollbar } from '@cherrystudio/ui'
import { RotateCcw, Search, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const RecallTestPanel = () => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex flex-1 items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.25 transition-all focus-within:border-emerald-400/40 focus-within:ring-1 focus-within:ring-emerald-400/15">
            <Search className="size-3.5 shrink-0 text-muted-foreground/30" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('knowledge_v2.recall.placeholder')}
              className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/30 focus-visible:border-0 focus-visible:ring-0 md:text-[0.6875rem]"
            />
            <Button
              type="button"
              variant="ghost"
              className="min-h-0 shrink-0 rounded-none p-0 text-muted-foreground/30 shadow-none hover:bg-transparent hover:text-foreground"
              onClick={() => setQuery('')}
              aria-label={t('common.reset')}>
              <RotateCcw className="size-3" />
            </Button>
          </div>

          <Button
            type="button"
            className="h-7 min-h-7 shrink-0 rounded-lg bg-emerald-400 px-3 text-[0.6875rem] text-white leading-4.125 shadow-none transition-all hover:bg-emerald-500 active:scale-[0.97]"
            onClick={() => undefined}>
            <Zap className="size-3" />
            {t('knowledge_v2.recall.submit')}
          </Button>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col items-center justify-center py-12 text-center text-muted-foreground/25">
          <Search className="size-5.5" />
          <p className="mt-1 text-[0.6875rem] leading-4.125">{t('knowledge_v2.recall.empty_title')}</p>
          <p className="mt-0.5 text-[0.5625rem] leading-3.375">{t('knowledge_v2.recall.empty_description')}</p>
        </div>
      </Scrollbar>
    </div>
  )
}

export default RecallTestPanel
