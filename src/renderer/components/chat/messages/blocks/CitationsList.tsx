import { Button } from '@cherrystudio/ui'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import type { Citation } from '@renderer/types/message'
import { FileSearch } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { getCitationHostname } from '../../citations/common'
import { useOptionalMessageListActions } from '../MessageListProvider'

interface CitationsListProps {
  citations: Citation[]
}

/** The "N sources" pill under a text block; opens the citations side panel. */
const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()
  const openCitationsPanel = useOptionalMessageListActions()?.openCitationsPanel

  const previewItems = citations.slice(0, 3)
  const count = citations.length
  if (!count) return null

  const handleOpenCitationsPanel = () => {
    openCitationsPanel?.({ citations })
  }

  return (
    <Button
      variant="ghost"
      disabled={!openCitationsPanel}
      onClick={handleOpenCitationsPanel}
      className="mb-2 inline-flex h-8 items-center gap-2 self-start rounded-full border border-border-subtle bg-card px-2.5 py-0 text-xs disabled:opacity-60">
      <div className="flex items-center gap-0.5">
        {previewItems.map((citation) => {
          const hostname = getCitationHostname(citation)
          return (
            <div
              key={`${citation.number}-${citation.url || citation.title}`}
              className="flex size-5 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-background text-muted-foreground">
              {citation.type === 'websearch' && hostname ? (
                <Favicon hostname={hostname} alt={citation.title || ''} />
              ) : (
                <FileSearch size={12} strokeWidth={2} />
              )}
            </div>
          )
        })}
      </div>
      <span className="h-3.5 w-px bg-border-subtle" />
      <span className="font-medium text-muted-foreground">{t('message.citation', { count })}</span>
    </Button>
  )
}

export default CitationsList
