import { PageSidePanel } from '@cherrystudio/ui'
import { CitationsPanelContent } from '@renderer/components/chat/messages/blocks/CitationsList'
import type { Citation } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  citations: Citation[]
}

const CitationsPanel = ({ open, onClose, citations }: Props) => {
  const { t } = useTranslation()
  const openPath = useCallback((path: string) => window.api.file.openPath(path), [])

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      header={<span className="font-medium text-sm">{t('message.citations')}</span>}
      closeLabel={t('common.close')}
      backdropClassName="bg-transparent dark:bg-transparent"
      bodyClassName="flex min-h-0 flex-col space-y-0 overflow-hidden p-0 pb-2">
      <CitationsPanelContent citations={citations} openPath={openPath} />
    </PageSidePanel>
  )
}

export default CitationsPanel
