/**
 * Knowledge citation views — the side-panel row (`KnowledgeCitationCard`) and
 * the inline tooltip body (`KnowledgeCitationHoverContent`) for a citation
 * backed by a knowledge-base document (memory citations reuse the card).
 * Unlike web citations there is no URL to open — the views show the source
 * document title and the matched snippet.
 */

import { FileSearch } from 'lucide-react'
import React from 'react'

import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import type { Citation } from '@renderer/types/message'

import { useOptionalMessageListActions } from '../messages/MessageListProvider'
import { type CitationPanelActions, CopyButton, handleLinkClick } from './common'

/** Display title: the basename of a path-like title (e.g. `User/path/example.pdf` → `example.pdf`). */
const documentTitle = (title?: string) => title?.split('/').pop()

export const KnowledgeCitationCard: React.FC<{ citation: Citation; actions?: CitationPanelActions }> = ({
  citation,
  actions
}) => {
  const providerActions = useOptionalMessageListActions()
  const linkActions = {
    openPath: actions?.openPath ?? providerActions?.openPath,
    openExternalUrl: actions?.openExternalUrl ?? providerActions?.openExternalUrl
  }

  return (
    <SelectionContextMenu>
      <div className="group relative flex w-full flex-col py-3 transition-all duration-300">
        <div className="relative mb-1.5 flex w-full flex-row items-center gap-2">
          {citation.showFavicon && <FileSearch width={16} />}
          {citation.url ? (
            <a
              className="flex-1 text-sm leading-[1.6] text-nowrap text-foreground no-underline"
              href={citation.url}
              onClick={(e) => handleLinkClick(citation.url, e, linkActions)}>
              {documentTitle(citation.title)}
            </a>
          ) : (
            <span className="flex-1 text-sm leading-[1.6] text-nowrap text-foreground">
              {documentTitle(citation.title)}
            </span>
          )}
          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] leading-[1.6] text-primary opacity-100 transition-opacity duration-300 group-hover:opacity-0">
            {citation.number}
          </div>
          {citation.content && <CopyButton content={citation.content} actions={actions} />}
        </div>
        <div className="selectable-text cursor-text text-[13px] leading-[1.6] break-all text-muted-foreground select-text">
          {citation.content ?? ''}
        </div>
      </div>
    </SelectionContextMenu>
  )
}

export interface KnowledgeCitationHoverData {
  title?: string
  content?: string
}

/** Inline tooltip body for a knowledge citation: document title + matched snippet, no external link. */
export const KnowledgeCitationHoverContent: React.FC<{ citation: KnowledgeCitationHoverData }> = ({ citation }) => {
  const title = documentTitle(citation.title)

  return (
    <div style={{ userSelect: 'text' }}>
      {title && (
        <div className="mb-2 flex items-center gap-2">
          <FileSearch size={16} className="shrink-0 text-muted-foreground" />
          <div
            className="overflow-hidden text-sm leading-[1.4] text-ellipsis whitespace-nowrap text-foreground"
            role="heading"
            aria-level={3}
            title={title}>
            {title}
          </div>
        </div>
      )}
      {citation.content?.trim() && (
        <div
          className="overflow-hidden text-[13px] leading-normal text-muted-foreground"
          role="article"
          style={{
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3
          }}>
          {citation.content}
        </div>
      )}
    </div>
  )
}
