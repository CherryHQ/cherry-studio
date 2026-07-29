/**
 * Web citation views — the side-panel row (`WebCitationCard`) and the inline
 * tooltip body (`WebCitationHoverContent`) for a citation that points at a web
 * page. Knowledge-base citations render through `KnowledgeCitation.tsx`.
 */

import { Skeleton } from '@cherrystudio/ui'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import MarqueeText from '@renderer/components/MarqueeText'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import type { Citation } from '@renderer/types/message'
import { fetchXOEmbed, isXPostUrl, xOembedKey } from '@renderer/utils/fetch'
import React, { useCallback, useMemo } from 'react'
import useSWRImmutable from 'swr/immutable'

import { useOptionalMessageListActions } from '../messages/MessageListProvider'
import { type CitationPanelActions, CopyButton, getCitationHostname, handleLinkClick, truncateText } from './common'
import { type CitationPreviewSession, useCitationPreview } from './hooks/useCitationPreview'

export const WebCitationCard: React.FC<{
  citation: Citation
  previewSession: CitationPreviewSession
  actions?: CitationPanelActions
}> = ({ citation, previewSession, actions }) => {
  const isXPost = Boolean(citation.url && isXPostUrl(citation.url))
  const previewUrl = citation.url && !isXPost ? citation.url : undefined
  const providerActions = useOptionalMessageListActions()
  const linkActions = {
    openPath: actions?.openPath ?? providerActions?.openPath,
    openExternalUrl: actions?.openExternalUrl ?? providerActions?.openExternalUrl
  }

  const { content: previewContent, isLoading: isPreviewLoading } = useCitationPreview(previewUrl, previewSession)

  const { data: oembedData, isLoading: isOembedLoading } = useSWRImmutable(
    isXPost && citation.url ? xOembedKey(citation.url) : null,
    () => fetchXOEmbed(citation.url),
    { shouldRetryOnError: false }
  )

  const fetchedContent = isXPost
    ? oembedData
      ? truncateText(`@${oembedData.author}: ${oembedData.text}`)
      : ''
    : previewContent
  const isLoading = isXPost ? isOembedLoading : isPreviewLoading
  const displayTitle = isXPost && oembedData?.author ? `@${oembedData.author}` : citation.title
  const titleContent = displayTitle || citation.hostname || citation.content || citation.url

  return (
    <SelectionContextMenu>
      <div className="group relative flex w-full flex-col py-3 transition-all duration-300">
        <div className="relative mb-1.5 flex w-full flex-row items-center gap-2">
          {citation.showFavicon && getCitationHostname(citation) && (
            <Favicon hostname={getCitationHostname(citation)!} alt={citation.title || citation.hostname || ''} />
          )}
          {citation.url ? (
            <a
              className="flex-1 text-nowrap text-foreground text-sm leading-[1.6] no-underline"
              href={citation.url}
              onClick={(e) => handleLinkClick(citation.url, e, linkActions)}>
              {displayTitle || <span className="text-link">{citation.hostname}</span>}
            </a>
          ) : (
            <span className="flex-1 text-nowrap text-foreground text-sm leading-[1.6]">{titleContent}</span>
          )}

          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary leading-[1.6] opacity-100 transition-opacity duration-300 group-hover:opacity-0">
            {citation.number}
          </div>
          {fetchedContent && <CopyButton content={fetchedContent} actions={actions} />}
        </div>
        {isLoading ? (
          <div className="space-y-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          fetchedContent && (
            <div className="selectable-text cursor-text select-text break-all text-[13px] text-muted-foreground leading-[1.6]">
              {fetchedContent}
            </div>
          )
        )}
      </div>
    </SelectionContextMenu>
  )
}

export interface WebCitationHoverData {
  url: string
  title?: string
  content?: string
}

/**
 * Inline tooltip body for a web citation. `isOpen` defers the X oEmbed
 * network request until the tooltip is actually opened — firing it on mount
 * for every X-post citation is a perf + privacy leak.
 */
export const WebCitationHoverContent: React.FC<{ citation: WebCitationHoverData; isOpen: boolean }> = ({
  citation,
  isOpen
}) => {
  const openExternalUrl = useOptionalMessageListActions()?.openExternalUrl
  const hostname = useMemo(() => {
    try {
      return new URL(citation.url).hostname
    } catch {
      return citation.url
    }
  }, [citation.url])

  const isXPost = useMemo(() => isXPostUrl(citation.url), [citation.url])

  // `staleTime: Infinity` keeps the result cached after the first open.
  const { data: oembedData } = useSWRImmutable(
    isXPost && !citation.content?.trim() && isOpen ? xOembedKey(citation.url) : null,
    () => fetchXOEmbed(citation.url),
    { shouldRetryOnError: false }
  )

  const sourceTitle = useMemo(() => {
    if (isXPost && oembedData?.author) return `@${oembedData.author}`
    return citation.title?.trim() || hostname
  }, [citation.title, hostname, isXPost, oembedData])

  const displayContent = useMemo(() => {
    if (citation.content?.trim()) return citation.content
    if (isXPost && oembedData?.text) return oembedData.text
    return undefined
  }, [citation.content, isXPost, oembedData])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!openExternalUrl) return
      event.preventDefault()
      void openExternalUrl(citation.url)
    },
    [citation.url, openExternalUrl]
  )

  return (
    <div style={{ userSelect: 'text' }}>
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex cursor-pointer items-center gap-2 hover:opacity-80"
        aria-label={`Open ${sourceTitle} in new tab`}
        onClick={handleClick}>
        <Favicon hostname={hostname} alt={sourceTitle} />
        <div
          className="overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-sm leading-[1.4]"
          role="heading"
          aria-level={3}
          title={sourceTitle}>
          <MarqueeText>{sourceTitle}</MarqueeText>
        </div>
      </a>
      {displayContent && (
        <div
          className="mb-2 overflow-hidden text-[13px] text-muted-foreground leading-normal [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box]"
          role="article"
          aria-label="Citation content"
          style={{
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3
          }}>
          {displayContent}
        </div>
      )}
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-link text-xs hover:underline"
        aria-label={`Visit ${hostname}`}
        onClick={handleClick}>
        {hostname}
      </a>
    </div>
  )
}
