import { useQuery } from '@data/hooks/useDataApi'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

interface KnowledgeItemNoteContentPanelProps {
  itemId: string
  onBack: () => void
}

const KnowledgeItemNoteContentState = ({ children }: { children: ReactNode }) => (
  <div className="text-foreground-muted flex min-h-full items-center justify-center px-4 py-10 text-center text-sm leading-5">
    {children}
  </div>
)

/**
 * In-app view of a note's original stored text (`data.content`). Notes have no external source to
 * open, so the row's primary click lands here; its indexed chunks stay a separate advanced action.
 */
const KnowledgeItemNoteContentPanel = ({ itemId, onBack }: KnowledgeItemNoteContentPanelProps) => {
  const {
    t,
    i18n: { language }
  } = useTranslation()
  const {
    data: item,
    isLoading,
    error
  } = useQuery('/knowledge-items/:id', {
    params: { id: itemId },
    enabled: Boolean(itemId)
  })
  const viewModel = item ? toKnowledgeItemRowViewModel(item, language) : null
  const Icon = viewModel?.icon.icon
  const content = item?.type === 'note' ? item.data.content : ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-11 shrink-0 items-center gap-2 px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-b after:border-border after:content-['']">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="text-foreground-muted size-5 min-h-5 min-w-5 rounded p-0 shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        {Icon && viewModel ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-subtle">
            <Icon className={cn('size-3.5', viewModel.icon.iconClassName)} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 text-foreground">
            {viewModel?.title ?? t('common.loading')}
          </span>
          <div className="text-foreground-muted flex items-center gap-2 text-xs leading-4">
            <span>{t('knowledge.data_source.actions.preview_source')}</span>
          </div>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1 px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isLoading ? <KnowledgeItemNoteContentState>{t('common.loading')}</KnowledgeItemNoteContentState> : null}
        {!isLoading && error ? <KnowledgeItemNoteContentState>{error.message}</KnowledgeItemNoteContentState> : null}
        {!isLoading && !error ? (
          <pre className="text-foreground-secondary font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
            {content}
          </pre>
        ) : null}
      </Scrollbar>
    </div>
  )
}

export default KnowledgeItemNoteContentPanel
