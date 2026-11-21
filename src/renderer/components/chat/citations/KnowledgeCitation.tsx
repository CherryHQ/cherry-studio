/**
 * Knowledge citation views — the side-panel row (`KnowledgeCitationCard`) and
 * the inline tooltip body (`KnowledgeCitationHoverContent`) for a citation
 * backed by a knowledge-base document (memory citations reuse the card).
 * Unlike web citations there is no URL to open — the views show the source
 * document title and the matched snippet.
 */

import { FileSearch } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import { FilePreview } from '@renderer/components/FilePreview'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import type { Citation } from '@renderer/types/message'

import { useOptionalMessageListActions } from '../messages/MessageListProvider'
import { type CitationPanelActions, CopyButton, handleLinkClick } from './common'
import { useKnowledgeCitation } from './useKnowledgeCitation'

/** Display title: the basename of a path-like title (e.g. `User/path/example.pdf` → `example.pdf`). */
const documentTitle = (title?: string) => title?.split('/').pop()

export const KnowledgeCitationCard: React.FC<{ citation: Citation; actions?: CitationPanelActions }> = ({
  citation,
  actions
}) => {
  const providerActions = useOptionalMessageListActions()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { canResolve, target, failed, resolve } = useKnowledgeCitation(citation)
  const unavailable = target?.status === 'unavailable' || target?.status === 'invalid'
  const location =
    citation.page !== undefined
      ? t('knowledge.citation.page', { page: citation.page })
      : citation.charStart !== undefined && citation.charEnd !== undefined
        ? t('knowledge.citation.range', { start: citation.charStart, end: citation.charEnd })
        : undefined
  const status = unavailable
    ? t(target.status === 'invalid' ? 'knowledge.citation.invalid' : 'knowledge.citation.unavailable')
    : failed
      ? t('file_preview.load_error.title')
      : undefined
  const openCitation = async () => {
    // Probe again at activation, a file may disappear after the card mounted.
    const result = await resolve()
    if (result?.status === 'available') setOpen(true)
  }
  const linkActions = {
    openBrowserUrl: actions?.openBrowserUrl ?? providerActions?.openBrowserUrl,
    openPath: actions?.openPath ?? providerActions?.openPath
  }

  return (
    <>
      <SelectionContextMenu openBrowserUrl={actions?.openBrowserUrl ?? providerActions?.openBrowserUrl}>
        <div className="group relative flex w-full flex-col py-3 transition-all duration-300">
          <div className="relative mb-1.5 flex w-full flex-row items-center gap-2">
            {citation.showFavicon && <FileSearch width={16} />}
            {canResolve ? (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm text-foreground underline-offset-2 hover:underline disabled:cursor-default"
                disabled={unavailable || (!target && !failed)}
                onClick={() => void openCitation()}>
                {documentTitle(citation.title)}
              </button>
            ) : citation.url ? (
              <a
                className="flex-1 text-sm leading-[1.6] text-nowrap text-foreground no-underline"
                href={citation.url}
                onAuxClick={(e) => handleLinkClick(citation.url, e, linkActions)}
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
            {citation.content && !unavailable && (!canResolve || target?.status === 'available') && (
              <CopyButton content={citation.content} actions={actions} />
            )}
          </div>
          {location && <div className="text-xs text-muted-foreground">{location}</div>}
          <div className="selectable-text cursor-text text-[13px] leading-[1.6] break-all text-muted-foreground select-text">
            {status ?? (canResolve && !target ? t('file_preview.loading') : (citation.content ?? ''))}
          </div>
        </div>
      </SelectionContextMenu>
      {open && (
        <Dialog open={target?.status === 'available'} onOpenChange={setOpen}>
          <DialogContent className="flex h-[85vh] w-[90vw] flex-col sm:max-w-5xl" aria-describedby={undefined}>
            <DialogTitle>{documentTitle(citation.title)}</DialogTitle>
            <div className="min-h-0 flex-1">
              {open && target?.status === 'available' && (
                <FilePreview
                  filePath={target.filePath}
                  pdfCitation={target.page ? { page: target.page, excerpt: target.excerpt } : undefined}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export interface KnowledgeCitationHoverData {
  title?: string
  content?: string
  baseId?: string
  conceptId?: string
  sourceId?: string
  page?: number
  charStart?: number
  charEnd?: number
}

/** Inline tooltip body for a knowledge citation: document title + matched snippet, no external link. */
export const KnowledgeCitationHoverContent: React.FC<{ citation: KnowledgeCitationHoverData }> = ({ citation }) => {
  const title = documentTitle(citation.title)
  const { t } = useTranslation()
  const { canResolve, target, failed } = useKnowledgeCitation({ number: 0, url: '', ...citation })
  const content =
    target?.status === 'invalid'
      ? t('knowledge.citation.invalid')
      : target?.status === 'unavailable'
        ? t('knowledge.citation.unavailable')
        : failed
          ? t('file_preview.load_error.title')
          : canResolve && !target
            ? t('file_preview.loading')
            : citation.content

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
      {content?.trim() && (
        <div
          className="overflow-hidden text-[13px] leading-normal text-muted-foreground"
          role="article"
          style={{
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3
          }}>
          {content}
        </div>
      )}
    </div>
  )
}
