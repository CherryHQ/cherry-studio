import { PageSidePanel, Scrollbar } from '@cherrystudio/ui'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import type { Citation } from '@renderer/types/message'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useCitationPreviewSession } from './citationPreview'
import type { CitationPanelActions } from './common'
import { KnowledgeCitationCard } from './KnowledgeCitation'
import { WebCitationCard } from './WebCitation'

interface Props {
  open: boolean
  onClose: () => void
  citations: Citation[]
}

interface CitationsPanelContentProps {
  citations: Citation[]
  actions?: CitationPanelActions
}

export const CitationsPanelContent: React.FC<CitationsPanelContentProps> = ({ citations, actions }) => {
  const previewSession = useCitationPreviewSession()

  return (
    <Scrollbar className="min-h-0 flex-1">
      {citations.map((citation) => (
        <div
          key={`${citation.number}-${citation.url || citation.title}`}
          className="border-border border-b-[0.5px] last:border-b-0">
          {citation.type === 'websearch' ? (
            <div className="max-w-[min(400px,60vw)] px-3">
              <WebCitationCard citation={citation} previewSession={previewSession} actions={actions} />
            </div>
          ) : (
            // knowledge and memory citations share the document card
            <div className="max-w-150 px-3">
              <KnowledgeCitationCard citation={citation} actions={actions} />
            </div>
          )}
        </div>
      ))}
    </Scrollbar>
  )
}

const CitationsPanel = ({ open, onClose, citations }: Props) => {
  const { t } = useTranslation()
  const openPath = useCallback((path: string) => window.api.file.openPath(path), [])
  const openExternalUrl = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])
  const { copyText, notifyError } = useMessagePlatformActions()

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      header={<span className="font-medium text-sm">{t('message.citations')}</span>}
      closeLabel={t('common.close')}
      bodyClassName="flex min-h-0 flex-col space-y-0 overflow-hidden p-0 pb-2">
      <CitationsPanelContent citations={citations} actions={{ openPath, openExternalUrl, copyText, notifyError }} />
    </PageSidePanel>
  )
}

export default CitationsPanel
