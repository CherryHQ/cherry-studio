import type { Topic as RendererTopic } from '@renderer/types/topic'
import { lazy, type ReactNode, Suspense } from 'react'

import type { HistoryRecordsMode } from './historyRecordsTypes'

const AgentHistoryRecords = lazy(() => import('./AgentHistoryRecords'))
const AssistantHistoryRecords = lazy(() => import('./AssistantHistoryRecords'))

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
      <Suspense fallback={null}>
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
