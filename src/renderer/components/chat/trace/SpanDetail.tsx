import { Check, ChevronsLeft, Copy } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CodeViewer from '@renderer/components/CodeViewer'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { toast } from '@renderer/services/toast'
import { download } from '@renderer/utils/download'
import { formatFileSize } from '@renderer/utils/file'

import { buildSpanView, type SpanDetailRow, type SpanTab } from './spanPresenters'
import type { TraceNode } from './traceNode'
import { convertTime } from './TraceTree'

const logger = loggerService.withContext('SpanDetail')

/**
 * Payloads above this size skip Shiki highlighting and render a truncated
 * preview first. `JSON.stringify` of a multi-MB span is fast enough, but
 * full Shiki tokenization + `CodeViewer` token arrays of that size freeze the
 * UI (issue #19564). Plain virtualized rows stay smooth.
 */
export const SPAN_DETAIL_LARGE_CONTENT_CHARS = 100_000
/** Preview length, deliberately tied to the large threshold so the preview itself is never large. */
export const SPAN_DETAIL_PREVIEW_CHARS = SPAN_DETAIL_LARGE_CONTENT_CHARS

interface SpanDetailProps {
  node: TraceNode
  onShowList: (input: boolean) => void
}

const SpanDetail: FC<SpanDetailProps> = ({ node, onShowList }) => {
  const [activeTab, setActiveTab] = useState<string>('inputs')
  const [copiedContent, setCopiedContent] = useTemporaryValue<{
    nodeId: string
    tab: string
    content: string
  } | null>(null)
  const { t } = useTranslation()

  // Span-type-specific rows and tabs come from the presenter registry.
  const view = useMemo(() => buildSpanView(node, t), [node, t])
  const { tabs } = view
  // Switching to a span that lacks the current tab (e.g. an AI span while on a header tab) falls back.
  const safeTab = tabs.some((tab) => tab.value === activeTab) ? activeTab : (tabs[0]?.value ?? 'inputs')
  // Derive synchronously so the code block never lingers on the previous tab's content.
  const formatted = useMemo(() => formatTabData(node, tabs, safeTab), [node, tabs, safeTab])
  const { content: fullContent, contentLanguage, isLarge } = formatted
  // Keyed expansion: a new span/tab derives collapsed synchronously on the first
  // render, so an expanded payload never flashes its full text via a post-render
  // `useEffect` reset (which runs after the full payload already rendered once).
  const contentKey = `${node.id}-${safeTab}`
  const [expandedContentKey, setExpandedContentKey] = useState<string | null>(null)
  const showFullLargeContent = expandedContentKey === contentKey
  // Preview slice is cheap; the full string stays in `formatted` for expand/download.
  // Copy always uses the full content so collapsed previews never silently copy partial text.
  const content = isLarge && !showFullLargeContent ? fullContent.slice(0, SPAN_DETAIL_PREVIEW_CHARS) : fullContent
  // `formatted.fullLength` is a char count; `formatFileSize` expects bytes, so
  // measure UTF-8 bytes (memoized, large-only) instead of passing chars as bytes.
  const fullSizeLabel = useMemo(() => {
    if (!isLarge) return ''
    return formatFileSize(new TextEncoder().encode(fullContent).length)
  }, [isLarge, fullContent])
  // Large payloads render as plain virtualized text (no Shiki worker) in both preview and full modes.
  const highlight = !isLarge
  const copied =
    copiedContent?.nodeId === node.id && copiedContent.tab === safeTab && copiedContent.content === fullContent

  const usedTime = convertTime((node.endTime || Date.now()) - node.startTime)
  const rows: SpanDetailRow[] = [
    { label: 'ID', value: node.id },
    { label: t('trace.name'), value: node.name },
    { label: t('trace.tag'), value: String(node.attributes?.tags || '') },
    { label: t('trace.startTime'), value: formatDate(node.startTime) },
    { label: t('trace.endTime'), value: formatDate(node.endTime) },
    { label: t('trace.spendTime'), value: usedTime },
    ...view.rows
  ]

  const handleCopy = async () => {
    if (!fullContent) return
    try {
      await navigator.clipboard.writeText(fullContent)
      setCopiedContent({ nodeId: node.id, tab: safeTab, content: fullContent })
    } catch (error) {
      logger.error('Failed to copy span detail content', error as Error)
      toast.error(t('common.copy_failed'))
    }
  }

  const handleDownload = () => {
    if (!fullContent) return
    const blob = new Blob([fullContent], {
      type: contentLanguage === 'json' ? 'application/json' : 'text/plain'
    })
    const url = URL.createObjectURL(blob)
    const filename = `trace-${node.id}-${safeTab}.${contentLanguage === 'json' ? 'json' : 'txt'}`
    const fail = (error: unknown) => {
      logger.error('Failed to download span detail content', error as Error)
      toast.error(t('common.save_failed'))
      URL.revokeObjectURL(url)
    }
    try {
      // Blob URLs take the helper's synchronous anchor-click path; guard the
      // async fetch path it also exposes.
      const result = download(url, filename)
      if (result instanceof Promise) {
        result.catch(fail)
        return
      }
    } catch (error) {
      fail(error)
      return
    }
    // Defer revocation so the download isn't aborted in browsers that resolve it asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 text-xs">
      <div className="mb-3 flex min-w-0 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm">{t('trace.spanDetail')}</div>
          <div className="mt-1 truncate text-muted-foreground">{node.name}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={() => onShowList(true)}>
          <ChevronsLeft size={14} />
          <span>{t('trace.backList')}</span>
        </Button>
      </div>

      <FieldGroup className="mb-3 shrink-0 gap-0 overflow-hidden rounded-md border border-border-subtle bg-background-subtle">
        {rows.map((row) => (
          <DetailField key={row.label} row={row} />
        ))}
      </FieldGroup>

      {isLarge && (
        <div className="mb-2 flex min-w-0 shrink-0 items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-2 py-1.5 text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {/* Generic wording: this banner serves every tab (inputs/outputs/headers/raw). */}
            {showFullLargeContent ? fullSizeLabel : `${t('error.truncatedBadge')} · ${fullSizeLabel}`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => setExpandedContentKey((prev) => (prev === contentKey ? null : contentKey))}>
            {showFullLargeContent ? t('common.collapse') : t('common.expand')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={handleDownload}>
            {t('common.download')}
          </Button>
        </div>
      )}

      <Tabs value={safeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TabsList className="h-8">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <Tooltip content={t('common.copy')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={copied ? 'text-success hover:text-success' : 'text-muted-foreground hover:text-foreground'}
              aria-label={t('common.copy')}
              disabled={!fullContent}
              onClick={() => void handleCopy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </Tooltip>
        </div>
        <TabsContent
          value={safeTab}
          className="min-h-0 flex-1 overflow-hidden rounded-md border border-border-subtle bg-popover">
          {/* key remounts the viewer per tab/mode so no fragment of the previous content lingers. */}
          <CodeViewer
            key={`${contentKey}-${showFullLargeContent ? 'full' : 'preview'}`}
            value={content}
            language={highlight ? contentLanguage : 'text'}
            expanded={false}
            height="100%"
            wrapped
            fontSize={12}
            options={{ lineNumbers: false, highlight }}
            className="selectable h-full [&_.shiki-scroller]:overflow-x-hidden"
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DetailField({ row }: { row: SpanDetailRow }) {
  return (
    <Field orientation="horizontal" className="border-border-subtle border-t px-3 py-2 first:border-t-0">
      <FieldContent className="min-w-24 max-w-32 shrink-0 gap-0">
        <FieldTitle className="font-normal text-muted-foreground text-xs">{row.label}</FieldTitle>
      </FieldContent>
      {row.content ?? (
        <FieldDescription className="min-w-0 flex-1 break-words text-foreground text-xs">{row.value}</FieldDescription>
      )}
    </Field>
  )
}

function formatDate(timestamp: number | null): string {
  if (timestamp == null) return ''
  const date = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${date.getMilliseconds().toString().padStart(3, '0')}`
}

/** Formatted tab payload. `content` is always the FULL text; the caller slices the preview. */
export interface FormattedTabData {
  content: string
  contentLanguage: 'json' | 'text'
  fullLength: number
  isLarge: boolean
}

/** Resolve the active tab's payload (with the ERROR-exception override) and format it as JSON or text. */
export function formatTabData(node: TraceNode, tabs: SpanTab[], activeTab: string): FormattedTabData {
  let data: unknown = tabs.find((tab) => tab.value === activeTab)?.data
  if (activeTab === 'outputs' && node.status === 'ERROR') {
    const exception = Array.isArray(node.events) ? node.events.find((e) => e.name === 'exception') : undefined
    if (exception) data = exception
  }
  let formatted: string
  let contentLanguage: 'json' | 'text' = 'text'
  // Fast path: strings already over budget skip JSON.parse + pretty-print — the
  // indented rewrite would only expand them further while blocking the main thread.
  // `looksJson` is a heuristic (no parse validation): it only affects the download
  // file extension, since large payloads always render as plain text.
  if (typeof data === 'string' && data.length > SPAN_DETAIL_LARGE_CONTENT_CHARS) {
    const looksJson = data.startsWith('{') || data.startsWith('[')
    return {
      content: data,
      contentLanguage: looksJson ? 'json' : 'text',
      fullLength: data.length,
      isLarge: true
    }
  }
  if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
    try {
      formatted = JSON.stringify(JSON.parse(data), null, 2)
      contentLanguage = 'json'
    } catch {
      // Not JSON; render the raw string as text.
      formatted = data
    }
  } else if (data && typeof data === 'object') {
    try {
      formatted = JSON.stringify(data, null, 2)
      contentLanguage = 'json'
    } catch {
      // Circular / unserializable payloads must never break the viewer.
      formatted = String(data)
      contentLanguage = 'text'
    }
  } else {
    formatted = String(data ?? '')
  }
  return {
    content: formatted,
    contentLanguage,
    fullLength: formatted.length,
    isLarge: formatted.length > SPAN_DETAIL_LARGE_CONTENT_CHARS
  }
}

export default SpanDetail
