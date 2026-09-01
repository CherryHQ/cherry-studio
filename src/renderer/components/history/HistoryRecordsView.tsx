import { lazy, type ReactNode, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@cherrystudio/ui'
import type { Topic as RendererTopic } from '@renderer/types/topic'

import type { HistoryRecordsMode } from './historyRecordsTypes'

const AgentHistoryRecords = lazy(() => import('./AgentHistoryRecords'))
const AssistantHistoryRecords = lazy(() => import('./AssistantHistoryRecords'))

// The toolbar and close button live inside the lazy chunk, so a null fallback leaves the panel the
// user just opened looking frozen.
function HistoryRecordsLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-1 flex-col gap-3 p-4">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

interface HistoryRecordsViewBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  onClose: () => void
  /** Leading navbar slot (shared sidebar toggle), mirrors ConversationResourceView's toolbarLeading. */
  toolbarLeading?: ReactNode
}

type HistoryRecordsViewProps =
  | (HistoryRecordsViewBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic | null) => void
    })
  | (HistoryRecordsViewBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string | null) => void
    })

const HistoryRecordsView = (props: HistoryRecordsViewProps) => {
  if (!props.open) return null

  return (
    <div className="flex min-h-0 flex-1 bg-card [-webkit-app-region:none]" data-testid="history-records-view">
      <Suspense fallback={<HistoryRecordsLoading />}>
        {props.mode === 'assistant' ? (
          <AssistantHistoryRecords
            activeRecordId={props.activeRecordId}
            onClose={props.onClose}
            onRecordSelect={props.onRecordSelect}
            toolbarLeading={props.toolbarLeading}
          />
        ) : (
          <AgentHistoryRecords
            activeRecordId={props.activeRecordId}
            onClose={props.onClose}
            onRecordSelect={props.onRecordSelect}
            toolbarLeading={props.toolbarLeading}
          />
        )}
      </Suspense>
    </div>
  )
}

export default HistoryRecordsView
