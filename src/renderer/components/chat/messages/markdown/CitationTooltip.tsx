import { NormalTooltip } from '@cherrystudio/ui'
import { KnowledgeCitationHoverContent } from '@renderer/components/chat/citations/KnowledgeCitation'
import { WebCitationHoverContent } from '@renderer/components/chat/citations/WebCitation'
import type { Citation } from '@renderer/types/message'
import React, { memo, useState } from 'react'

interface CitationTooltipProps {
  children: React.ReactNode
  citation: Citation
}

const CitationTooltip: React.FC<CitationTooltipProps> = ({ children, citation }) => {
  // Passed down so the web hover defers its X oEmbed request until opened.
  const [isOpen, setIsOpen] = useState(false)

  const isWeb = Boolean(citation.url) && citation.type !== 'knowledge' && citation.type !== 'memory'
  const hasHoverContent = isWeb || Boolean(citation.title?.trim() || citation.content?.trim())
  if (!hasHoverContent) return <>{children}</>

  const tooltipContent = isWeb ? (
    <WebCitationHoverContent
      citation={{ url: citation.url, title: citation.title, content: citation.content }}
      isOpen={isOpen}
    />
  ) : (
    <KnowledgeCitationHoverContent citation={{ title: citation.title, content: citation.content }} />
  )

  return (
    <NormalTooltip
      content={tooltipContent}
      onOpenChange={setIsOpen}
      showArrow={false}
      contentProps={{
        className: 'rounded-[8px] border border-border bg-card p-3 text-card-foreground'
      }}>
      {children}
    </NormalTooltip>
  )
}

export default memo(CitationTooltip)
