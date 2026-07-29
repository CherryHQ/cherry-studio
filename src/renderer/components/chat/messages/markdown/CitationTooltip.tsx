import { Tooltip } from '@cherrystudio/ui'
import React, { memo, useState } from 'react'
import * as z from 'zod'

import { KnowledgeCitationHoverContent } from '../../citations/KnowledgeCitation'
import { WebCitationHoverContent } from '../../citations/WebCitation'

/**
 * Shape of the `data-citation` JSON carried by inline `<sup>` tags (see
 * `generateCitationTag`). `type` discriminates the hover card: web citations
 * link out, knowledge/memory citations have no URL and show a document card.
 */
export const CitationSchema = z.object({
  type: z.string().optional(),
  /** Display number of the badge; `CitationSup` folds it into the accessible name. */
  id: z.number().optional(),
  // Not `z.url()`: migrated v1 knowledge citations store a bare file path (or the literal
  // `note`) here, and rejecting those drops the whole citation — and with it the hover card.
  url: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional()
})

interface CitationTooltipProps {
  children: React.ReactNode
  citation: z.infer<typeof CitationSchema>
}

const CitationTooltip: React.FC<CitationTooltipProps> = ({ children, citation }) => {
  // Passed down so the web hover defers its X oEmbed request until opened.
  const [isOpen, setIsOpen] = useState(false)

  const isWeb = Boolean(citation.url) && citation.type !== 'knowledge' && citation.type !== 'memory'
  const hasHoverContent = isWeb || Boolean(citation.title?.trim() || citation.content?.trim())
  if (!hasHoverContent) return <>{children}</>

  const tooltipContent = isWeb ? (
    <WebCitationHoverContent
      citation={{ url: citation.url!, title: citation.title, content: citation.content }}
      isOpen={isOpen}
    />
  ) : (
    <KnowledgeCitationHoverContent citation={{ title: citation.title, content: citation.content }} />
  )

  return (
    <Tooltip
      content={tooltipContent}
      onOpenChange={setIsOpen}
      showArrow={false}
      className="rounded-[8px] border border-border bg-card p-3 text-card-foreground">
      {children}
    </Tooltip>
  )
}

export default memo(CitationTooltip)
