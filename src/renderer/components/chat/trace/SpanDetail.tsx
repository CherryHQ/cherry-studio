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

import { buildSpanView, type SpanDetailRow, type SpanTab } from './spanPresenters'
import type { TraceNode } from './traceNode'
import { convertTime } from './TraceTree'

const logger = loggerService.withContext('SpanDetail')

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
  const { content, contentLanguage } = useMemo(() => formatTabData(node, tabs, safeTab), [node, tabs, safeTab])
  const copied = copiedContent?.nodeId === node.id && copiedContent.tab === safeTab && copiedContent.content === content

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
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopiedContent({ nodeId: node.id, tab: safeTab, content })
    } catch (error) {
      logger.error('Failed to copy span detail content', error as Error)
      toast.error(t('common.copy_failed'))
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 text-xs">
      <div className="mb-3 flex min-w-0 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{t('trace.spanDetail')}</div>
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
              disabled={!content}
              onClick={() => void handleCopy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </Tooltip>
        </div>
        <TabsContent
          value={safeTab}
          className="min-h-0 flex-1 overflow-hidden rounded-md border border-border-subtle bg-popover">
          {/* key remounts the viewer per tab so no fragment of the previous tab's content lingers. */}
          <CodeViewer
            key={safeTab}
            value={content}
            language={contentLanguage}
            expanded={false}
            height="100%"
            wrapped
            fontSize={12}
            options={{ lineNumbers: false }}
            className="selectable h-full [&_.shiki-scroller]:overflow-x-hidden"
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DetailField({ row }: { row: SpanDetailRow }) {
  return (
    <Field orientation="horizontal" className="border-t border-border-subtle px-3 py-2 first:border-t-0">
      <FieldContent className="max-w-32 min-w-24 shrink-0 gap-0">
        <FieldTitle className="text-xs font-normal text-muted-foreground">{row.label}</FieldTitle>
      </FieldContent>
      {row.content ?? (
        <FieldDescription className="min-w-0 flex-1 text-xs break-words text-foreground">{row.value}</FieldDescription>
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

/** Resolve the active tab's payload (with the ERROR-exception override) and format it as JSON or text. */
function formatTabData(
  node: TraceNode,
  tabs: SpanTab[],
  activeTab: string
): { content: string; contentLanguage: 'json' | 'text' } {
  let data: unknown = tabs.find((tab) => tab.value === activeTab)?.data
  if (activeTab === 'outputs' && node.status === 'ERROR') {
    const exception = Array.isArray(node.events) ? node.events.find((e) => e.name === 'exception') : undefined
    if (exception) data = exception
  }
  if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
    try {
      return { content: JSON.stringify(JSON.parse(data), null, 2), contentLanguage: 'json' }
    } catch {
      // Not JSON; render the raw string as text.
    }
  } else if (data && typeof data === 'object') {
    return { content: JSON.stringify(data, null, 2), contentLanguage: 'json' }
  }
  return { content: String(data ?? ''), contentLanguage: 'text' }
}

export default SpanDetail
