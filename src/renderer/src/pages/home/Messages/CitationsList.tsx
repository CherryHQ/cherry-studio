import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@cherrystudio/ui'
import ContextMenu from '@renderer/components/ContextMenu'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import type { Citation } from '@renderer/types'
import { fetchWebContent, fetchXOEmbed, isXPostUrl } from '@renderer/utils/fetch'
import { cleanMarkdownContent } from '@renderer/utils/formats'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Check, Copy, FileSearch } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface CitationsListProps {
  citations: Citation[]
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})

/**
 * 限制文本长度
 * @param text
 * @param maxLength
 */
const truncateText = (text: string, maxLength = 100) => {
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()

  const previewItems = citations.slice(0, 3)
  const count = citations.length
  if (!count) return null

  const popoverContent = (
    <Scrollbar className="max-h-[70vh]">
      {citations.map((citation) => (
        <div
          key={citation.url || citation.number || citation.title}
          className="border-(--color-border)/50 border-b last:border-b-0">
          {citation.type === 'websearch' && (
            <div className="max-w-[min(400px,60vw)] px-3">
              <WebSearchCitation citation={citation} />
            </div>
          )}
          {citation.type === 'memory' && (
            <div className="max-w-[600px] px-3">
              <KnowledgeCitation citation={{ ...citation }} />
            </div>
          )}
          {citation.type === 'knowledge' && (
            <div className="max-w-[600px] px-3">
              <KnowledgeCitation citation={{ ...citation }} />
            </div>
          )}
        </div>
      ))}
    </Scrollbar>
  )

  return (
    <QueryClientProvider client={queryClient}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="mb-2 flex self-start rounded-[var(--list-item-border-radius)] bg-(--color-background-soft) px-2 py-[3px] text-xs">
            <div className="flex items-center">
              {previewItems.map((c, i) => (
                <div
                  key={i}
                  className="ml-[-8px] flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-(--color-border) bg-(--color-background-soft) text-(--color-text-2) first:ml-0"
                  style={{ zIndex: previewItems.length - i }}>
                  {c.type === 'websearch' && c.url ? (
                    <Favicon hostname={new URL(c.url).hostname} alt={c.title || ''} />
                  ) : (
                    <FileSearch width={16} />
                  )}
                </div>
              ))}
            </div>
            {t('message.citation', { count })}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          className="w-auto max-w-[min(720px,80vw)] p-0 [&_a]:cursor-pointer"
          sideOffset={8}>
          <div className="mb-[-8px] border-(--color-border) border-b px-3 py-2 font-bold">{t('message.citations')}</div>
          <div className="pb-2">{popoverContent}</div>
        </PopoverContent>
      </Popover>
    </QueryClientProvider>
  )
}

const handleLinkClick = (url: string, event: React.MouseEvent) => {
  event.preventDefault()
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener,noreferrer')
  else void window.api.file.openPath(url)
}

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
        window.toast.success(t('common.copied'))
      })
      .catch(() => {
        window.toast.error(t('message.copy.failed'))
      })
  }

  return (
    <div
      onClick={handleCopy}
      className="-translate-y-1/2 absolute top-1/2 right-0 flex cursor-pointer items-center justify-center rounded-[4px] p-1 text-(--color-text-2) opacity-0 transition-opacity duration-300 ease-out hover:bg-(--color-background-soft) hover:opacity-100 group-hover:opacity-100">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </div>
  )
}

const WebSearchCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  const isXPost = Boolean(citation.url && isXPostUrl(citation.url))

  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['webContent', citation.url],
    queryFn: async () => {
      if (!citation.url) return ''
      if (isXPost) {
        const oembed = await fetchXOEmbed(citation.url)
        if (oembed) {
          return `@${oembed.author}: ${oembed.text}`
        }
        return ''
      }
      const res = await fetchWebContent(citation.url, 'markdown')
      return cleanMarkdownContent(res.content)
    },
    enabled: Boolean(citation.url),
    select: (content) => truncateText(content, 100)
  })

  const { data: oembedData } = useQuery({
    queryKey: ['xOembed', citation.url],
    queryFn: () => fetchXOEmbed(citation.url),
    enabled: isXPost && Boolean(citation.url),
    staleTime: Infinity
  })

  const displayTitle = isXPost && oembedData?.author ? `@${oembedData.author}` : citation.title

  return (
    <ContextMenu>
      <div className="group relative flex w-full flex-col py-3 transition-all duration-300 ease-out">
        <div className="relative mb-1.5 flex w-full flex-row items-center gap-2">
          {citation.showFavicon && citation.url && (
            <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
          )}
          <a
            className="flex-1 text-nowrap text-(--color-text-1) text-sm leading-[1.6] no-underline [&_.hostname]:text-(--color-link)"
            href={citation.url}
            onClick={(e) => handleLinkClick(citation.url, e)}>
            {displayTitle || <span className="hostname">{citation.hostname}</span>}
          </a>

          <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-(--color-reference) text-(--color-reference-text) text-[10px] leading-[1.6] opacity-100 transition-opacity duration-300 ease-out group-hover:opacity-0">
            {citation.number}
          </div>
          {fetchedContent && <CopyButton content={fetchedContent} />}
        </div>
        {isLoading ? (
          <Skeleton className="h-4 w-full rounded-sm" />
        ) : (
          <div className="selectable-text cursor-text select-text break-all text-(--color-text-2) text-[13px] leading-[1.6]">
            {fetchedContent}
          </div>
        )}
      </div>
    </ContextMenu>
  )
}

const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  return (
    <ContextMenu>
      <div className="group relative flex w-full flex-col py-3 transition-all duration-300 ease-out">
        <div className="relative mb-1.5 flex w-full flex-row items-center gap-2">
          {citation.showFavicon && <FileSearch width={16} />}
          <a
            className="flex-1 text-nowrap text-(--color-text-1) text-sm leading-[1.6] no-underline [&_.hostname]:text-(--color-link)"
            href={citation.url}
            onClick={(e) => handleLinkClick(citation.url, e)}>
            {/* example title: User/path/example.pdf */}
            {citation.title?.split('/').pop()}
          </a>
          <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-(--color-reference) text-(--color-reference-text) text-[10px] leading-[1.6] opacity-100 transition-opacity duration-300 ease-out group-hover:opacity-0">
            {citation.number}
          </div>
          {citation.content && <CopyButton content={citation.content} />}
        </div>
        <div className="selectable-text cursor-text select-text break-all text-(--color-text-2) text-[13px] leading-[1.6]">
          {citation.content ?? ''}
        </div>
      </div>
    </ContextMenu>
  )
}

export default CitationsList
