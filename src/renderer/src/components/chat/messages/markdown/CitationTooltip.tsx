import { Tooltip } from '@cherrystudio/ui'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import MarqueeText from '@renderer/components/MarqueeText'
import { fetchXOEmbed, isXPostUrl } from '@renderer/utils/fetch'
import { useQuery } from '@tanstack/react-query'
import React, { memo, useCallback, useMemo } from 'react'
import * as z from 'zod'

export const CitationSchema = z.object({
  url: z.url(),
  title: z.string().optional(),
  content: z.string().optional()
})

interface CitationTooltipProps {
  children: React.ReactNode
  citation: z.infer<typeof CitationSchema>
}

const CitationTooltip: React.FC<CitationTooltipProps> = ({ children, citation }) => {
  const hostname = useMemo(() => {
    try {
      return new URL(citation.url).hostname
    } catch {
      return citation.url
    }
  }, [citation.url])

  const isXPost = useMemo(() => isXPostUrl(citation.url), [citation.url])

  const { data: oembedData } = useQuery({
    queryKey: ['xOembed', citation.url],
    queryFn: () => fetchXOEmbed(citation.url),
    enabled: isXPost && !citation.content?.trim(),
    staleTime: Infinity
  })

  const sourceTitle = useMemo(() => {
    if (isXPost && oembedData?.author) return `@${oembedData.author}`
    return citation.title?.trim() || hostname
  }, [citation.title, hostname, isXPost, oembedData])

  const displayContent = useMemo(() => {
    if (citation.content?.trim()) return citation.content
    if (isXPost && oembedData?.text) return oembedData.text
    return undefined
  }, [citation.content, isXPost, oembedData])

  const handleClick = useCallback(() => {
    window.open(citation.url, '_blank', 'noopener,noreferrer')
  }, [citation.url])

  // 自定义悬浮卡片内容
  const tooltipContent = useMemo(
    () => (
      <div style={{ userSelect: 'text' }}>
        <div
          className="mb-2 flex cursor-pointer items-center gap-2 hover:opacity-80"
          role="button"
          aria-label={`Open ${sourceTitle} in new tab`}
          onClick={handleClick}>
          <Favicon hostname={hostname} alt={sourceTitle} />
          <div
            className="overflow-hidden text-ellipsis whitespace-nowrap text-(--color-text-1) text-sm leading-[1.4]"
            role="heading"
            aria-level={3}
            title={sourceTitle}>
            <MarqueeText>{sourceTitle}</MarqueeText>
          </div>
        </div>
        {displayContent && (
          <div
            className="mb-2 overflow-hidden text-(--color-text-2) text-[13px] leading-normal [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box]"
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
        <div
          className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-(--color-link) text-xs hover:underline"
          role="button"
          aria-label={`Visit ${hostname}`}
          onClick={handleClick}>
          {hostname}
        </div>
      </div>
    ),
    [displayContent, hostname, handleClick, sourceTitle]
  )

  return (
    <Tooltip
      content={tooltipContent}
      showArrow={false}
      className="rounded-[8px] border border-(--color-border) bg-(--color-background) p-3">
      {children}
    </Tooltip>
  )
}

export default memo(CitationTooltip)
