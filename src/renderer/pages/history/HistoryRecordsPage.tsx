import type { Topic as RendererTopic } from '@renderer/types/topic'
import type { ReactNode } from 'react'

import AgentHistoryRecords from './AgentHistoryRecords'
import AssistantHistoryRecords from './AssistantHistoryRecords'
import type { HistoryRecordsMode } from './historyRecordsTypes'

interface HistoryRecordsPageBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  onClose: () => void
  /** Leading navbar slot (shared sidebar toggle), mirrors ConversationResourceView's toolbarLeading. */
  toolbarLeading?: ReactNode
}

type HistoryRecordsPageProps =
  | (HistoryRecordsPageBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic | null) => void
    })
  | (HistoryRecordsPageBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string | null) => void
    })

const HistoryRecordsPage = (props: HistoryRecordsPageProps) => {
  if (!props.open) return null

  return (
    <div className="flex min-h-0 flex-1 bg-card [-webkit-app-region:none]" data-testid="history-records-page">
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
    </div>
  )
}

export default HistoryRecordsPage
