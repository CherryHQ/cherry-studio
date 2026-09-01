import { Button, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

interface KnowledgeItemNoteContentPanelProps {
  itemId: string
  onBack: () => void
}

const KnowledgeItemNoteContentState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center px-4 py-10 text-center text-foreground-muted text-sm leading-5">
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
      <div className="relative flex h-11 shrink-0 items-center gap-2 px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-border after:border-b after:content-['']">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="size-5 min-h-5 min-w-5 rounded p-0 text-foreground-muted shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        {Icon && viewModel ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-subtle">
            <Icon className={cn('size-3.5', viewModel.icon.iconClassName)} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-foreground text-sm leading-5">
            {viewModel?.title ?? t('common.loading')}
          </span>
          <div className="flex items-center gap-2 text-foreground-muted text-xs leading-4">
            <span>{t('knowledge.data_source.actions.preview_source')}</span>
          </div>
        </div>
      </div>

      <Scrollbar autoHideScrollbar={false} className="min-h-0 flex-1 px-4 py-3">
        {isLoading ? <KnowledgeItemNoteContentState>{t('common.loading')}</KnowledgeItemNoteContentState> : null}
        {!isLoading && error ? <KnowledgeItemNoteContentState>{error.message}</KnowledgeItemNoteContentState> : null}
        {!isLoading && !error ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-foreground-secondary text-sm leading-relaxed">
            {content}
          </pre>
        ) : null}
      </Scrollbar>
    </div>
  )
}

export default KnowledgeItemNoteContentPanel
