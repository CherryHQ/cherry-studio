import { lazy, type ReactNode, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@cherrystudio/ui'
import type { Topic as RendererTopic } from '@renderer/types/topic'

import type { HistoryRecordsMode } from './historyRecordsTypes'

const AgentHistoryRecords = lazy(() => import('./AgentHistoryRecords'))
const AssistantHistoryRecords = lazy(() => import('./AssistantHistoryRecords'))

function HistoryRecordsLoading({ toolbarLeading }: { toolbarLeading?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {toolbarLeading && <div className="flex h-11 shrink-0 items-center px-2">{toolbarLeading}</div>}
      <div role="status" aria-live="polite" className="flex flex-col gap-3 p-4">
        <span className="sr-only">{t('common.loading')}</span>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}

interface HistoryRecordsViewBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  onClose: () => void
  toolbarLeading?: ReactNode
}

type HistoryRecordsViewProps =
  | (HistoryRecordsViewBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic) => void
      onActiveRecordChange?: (topic: RendererTopic | null) => void
      /** Active while History is permanently deleting `id`; `null` after that attempt settles. */
      onLocalPermanentDeletePendingChange?: (id: string | null) => void
    })
  | (HistoryRecordsViewBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string) => void
      onActiveRecordChange?: (sessionId: string | null) => void
      /** Active while History is permanently deleting `id`; `null` after that attempt settles. */
      onLocalPermanentDeletePendingChange?: (id: string | null) => void
    })

const HistoryRecordsView = (props: HistoryRecordsViewProps) => {
  if (!props.open) return null

  return (
    <div className="flex min-h-0 flex-1 bg-card [-webkit-app-region:none]" data-testid="history-records-view">
      <Suspense fallback={<HistoryRecordsLoading toolbarLeading={props.toolbarLeading} />}>
        {props.mode === 'assistant' ? (
          <AssistantHistoryRecords
            activeRecordId={props.activeRecordId}
            onClose={props.onClose}
            onRecordSelect={props.onRecordSelect}
            onActiveRecordChange={props.onActiveRecordChange}
            onLocalPermanentDeletePendingChange={props.onLocalPermanentDeletePendingChange}
            toolbarLeading={props.toolbarLeading}
          />
        ) : (
          <AgentHistoryRecords
            activeRecordId={props.activeRecordId}
            onClose={props.onClose}
            onRecordSelect={props.onRecordSelect}
            onActiveRecordChange={props.onActiveRecordChange}
            onLocalPermanentDeletePendingChange={props.onLocalPermanentDeletePendingChange}
            toolbarLeading={props.toolbarLeading}
          />
        )}
      </Suspense>
    </div>
  )
}

export default HistoryRecordsView
