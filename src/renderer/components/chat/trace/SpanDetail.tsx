import './Trace.css'

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
  TabsTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CodeViewer from '@renderer/components/CodeViewer'
import { ChevronsLeft } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TraceModal } from './TraceModel'
import { convertTime } from './TraceTree'

const logger = loggerService.withContext('SpanDetail')
type TraceDetailTab = 'inputs' | 'outputs' | 'raw'

interface SpanDetailProps {
  node: TraceModal
  clickShowModal: (input: boolean) => void
}

const SpanDetail: FC<SpanDetailProps> = ({ node, clickShowModal }) => {
  const [activeTab, setActiveTab] = useState<TraceDetailTab>('inputs')
  const [content, setContent] = useState('')
  const [contentLanguage, setContentLanguage] = useState<'json' | 'text'>('json')
  const [usedTime, setUsedTime] = useState<string>('')
  const { t } = useTranslation()

  const changeContent = useCallback(() => {
    let data: any = {}
    if (node.attributes) {
      data = getSpanDetailData(node, activeTab)

      if (activeTab === 'outputs' && node.status === 'ERROR') {
        const exception =
          node.events && Array.isArray(node.events) ? node.events?.find((e) => e.name === 'exception') : undefined
        if (exception) data = exception
      }
    }

    if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
      try {
        setContent(JSON.stringify(JSON.parse(data), null, 2))
        setContentLanguage('json')
        return
      } catch {
        logger.debug('Span detail content is not JSON', { nodeId: node.id })
      }
    } else if (typeof data === 'object' || Array.isArray(data)) {
      setContent(JSON.stringify(data ?? {}, null, 2))
      setContentLanguage('json')
      return
    }

    setContent(String(data ?? ''))
    setContentLanguage('text')
  }, [node, activeTab])

  useEffect(() => {
    setUsedTime(convertTime((node.endTime || Date.now()) - node.startTime))
    changeContent()
  }, [node.endTime, node.startTime, node.attributes, node.events, changeContent])

  const formatDate = (timestamp: number | null) => {
    if (timestamp == null) {
      return ''
    }
    const date = new Date(timestamp)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds())}`
  }

  const detailRows = [
    ['ID', node.id],
    [t('trace.name'), node.name],
    [t('trace.tag'), String(node.attributes?.tags || '')],
    [t('trace.startTime'), formatDate(node.startTime)],
    [t('trace.endTime'), formatDate(node.endTime)],
    [t('trace.spendTime'), usedTime]
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 text-xs">
      <div className="mb-3 flex min-w-0 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm">{t('trace.spanDetail')}</div>
          <div className="mt-1 truncate text-muted-foreground">{node.name}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={() => clickShowModal(true)}>
          <ChevronsLeft size={14} />
          <span>{t('trace.backList')}</span>
        </Button>
      </div>

      <FieldGroup className="mb-3 shrink-0 gap-0 overflow-hidden rounded-md border border-border-subtle bg-background-subtle">
        {detailRows.map(([label, value]) => (
          <DetailField key={label} label={label} value={value} />
        ))}
        {node.usage && (
          <Field orientation="horizontal" className="border-border-subtle border-t px-3 py-2">
            <FieldContent className="min-w-24 max-w-32 shrink-0 gap-0">
              <FieldTitle className="font-normal text-muted-foreground text-xs">{t('trace.tokenUsage')}</FieldTitle>
            </FieldContent>
            <div className="min-w-0 flex-1">
              <span className="trace-token-prompt">{`↑${node.usage.prompt_tokens}`}</span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="trace-token-completion">{`↓${node.usage.completion_tokens}`}</span>
            </div>
          </Field>
        )}
      </FieldGroup>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TraceDetailTab)}
        className="min-h-0 flex-1 gap-2 overflow-hidden">
        <TabsList className="h-8 w-fit">
          <TabsTrigger value="inputs">{t('trace.inputs')}</TabsTrigger>
          <TabsTrigger value="outputs">{t('trace.outputs')}</TabsTrigger>
          <TabsTrigger value="raw">{t('message.tools.raw')}</TabsTrigger>
        </TabsList>
        <TabsContent
          value={activeTab}
          className="min-h-0 flex-1 overflow-hidden rounded-md border border-border-subtle bg-popover">
          <CodeViewer
            value={content}
            language={contentLanguage}
            expanded={false}
            height="100%"
            wrapped
            fontSize={12}
            options={{ lineNumbers: false }}
            className="trace-code-viewer"
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <Field orientation="horizontal" className="border-border-subtle border-t px-3 py-2 first:border-t-0">
      <FieldContent className="min-w-24 max-w-32 shrink-0 gap-0">
        <FieldTitle className="font-normal text-muted-foreground text-xs">{label}</FieldTitle>
      </FieldContent>
      <FieldDescription className="min-w-0 flex-1 break-words text-foreground text-xs">{value}</FieldDescription>
    </Field>
  )
}
const getSpanDetailData = (node: TraceModal, tab: TraceDetailTab) => {
  if (tab === 'inputs') return getSpanInputs(node)
  if (tab === 'outputs') return getSpanOutputs(node)
  return {
    id: node.id,
    traceId: node.traceId,
    parentId: node.parentId,
    name: node.name,
    status: node.status,
    kind: node.kind,
    topicId: node.topicId,
    modelName: node.modelName,
    usage: node.usage,
    attributes: node.attributes,
    events: node.events,
    links: node.links
  }
}

const getSpanInputs = (node: TraceModal) => {
  const attrs = node.attributes ?? {}
  return (
    attrs.inputs ??
    attrs.user_prompt ??
    attrs.tool_input ??
    attrs.tool_parameters ??
    getEventValue(node, ['user_prompt', 'claude_code.user_prompt'], ['prompt', 'log.body']) ??
    getEventValue(node, ['api_request_body', 'claude_code.api_request_body'], ['body', 'body_ref']) ??
    getEventValue(node, ['tool.output'], ['input', 'tool_input', 'tool.input']) ??
    pickAttributes(attrs, [
      'new_context',
      'system_prompt_preview',
      'user_system_prompt',
      'model',
      'gen_ai.request.model',
      'query_source',
      'tool_name',
      'file_path',
      'full_command',
      'skill_name',
      'subagent_type',
      'hook_event',
      'hook_name',
      'hook_definitions'
    ])
  )
}

const getSpanOutputs = (node: TraceModal) => {
  const attrs = node.attributes ?? {}
  return (
    attrs.outputs ??
    attrs['response.model_output'] ??
    attrs.model_output ??
    getEventValue(node, ['api_response_body', 'claude_code.api_response_body'], ['body', 'body_ref']) ??
    getEventValue(node, ['tool.output'], ['output', 'tool_output', 'tool.output', 'result']) ??
    getEventValue(node, ['tool_result', 'claude_code.tool_result'], ['tool_result', 'result', 'log.body']) ??
    pickAttributes(attrs, [
      'request_id',
      'gen_ai.response.id',
      'stop_reason',
      'response.has_tool_call',
      'result_tokens',
      'success',
      'error',
      'duration_ms'
    ])
  )
}

const getEventValue = (node: TraceModal, eventNames: string[], keys: string[]) => {
  for (const event of node.events ?? []) {
    if (!eventNames.includes(getEventName(event))) continue
    for (const key of keys) {
      const value = event.attributes?.[key]
      if (value !== undefined) return value
    }
  }
  return undefined
}

const getEventName = (event: NonNullable<TraceModal['events']>[number]) => {
  const name = event.attributes?.['event.name']
  return typeof name === 'string' ? name : event.name
}

const pickAttributes = (attributes: NonNullable<TraceModal['attributes']>, keys: string[]) => {
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    const value = attributes[key]
    if (value !== undefined) picked[key] = value
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

export default SpanDetail
