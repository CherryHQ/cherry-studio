import './Trace.css'

import { DoubleLeftOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
// import TraceModal from '@renderer/trace/TraceModal'
import type { TraceModal } from '@renderer/windows/trace/pages/TraceModel'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactJson from 'react-json-view'

import { Box, Button, Text } from './Component'
import { convertTime } from './TraceTree'

const logger = loggerService.withContext('SpanDetail')
type TraceDetailTab = 'inputs' | 'outputs' | 'raw'

interface SpanDetailProps {
  node: TraceModal
  clickShowModal: (input: boolean) => void
}

const SpanDetail: FC<SpanDetailProps> = ({ node, clickShowModal }) => {
  const [activeTab, setActiveTab] = useState<TraceDetailTab>('inputs')
  const [jsonData, setJsonData] = useState<object>({})
  const [isJson, setIsJson] = useState(false)
  const [usedTime, setUsedTime] = useState<string>('')
  const { t } = useTranslation()

  const changeJsonData = useCallback(() => {
    let data: any = {}
    if (!node.attributes) {
      setJsonData(data)
      setIsJson(true)
      return
    }
    data = getSpanDetailData(node, activeTab)

    if (activeTab === 'outputs' && node.status === 'ERROR') {
      const exception =
        node.events && Array.isArray(node.events) ? node.events?.find((e) => e.name === 'exception') : undefined
      if (exception) data = exception
    }

    if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
      try {
        setJsonData(JSON.parse(data))
        setIsJson(true)
        return
      } catch {
        logger.debug('Span detail content is not JSON', { nodeId: node.id })
      }
    } else if (typeof data === 'object' || Array.isArray(data)) {
      setJsonData(data)
      setIsJson(true)
      return
    }
    setIsJson(false)
    setJsonData(data as unknown as object)
  }, [node, activeTab])

  useEffect(() => {
    setUsedTime(convertTime((node.endTime || Date.now()) - node.startTime))
    changeJsonData()
  }, [node.endTime, node.startTime, node.attributes, node.events, changeJsonData])

  useEffect(() => {
    const updateCopyButtonTitles = () => {
      const copyButtons = document.querySelectorAll('.copy-to-clipboard-container > span')
      copyButtons.forEach((btn) => {
        btn.setAttribute('title', t('code_block.copy.label'))
      })
    }

    updateCopyButtonTitles()
    const timer = setInterval(updateCopyButtonTitles, 100) // 每秒检查一次

    return () => clearInterval(timer)
  }, [t])

  const formatDate = (timestamp: number | null) => {
    if (timestamp == null) {
      return ''
    }
    const date = new Date(timestamp)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds())}`
  }

  return (
    <Box padding={5}>
      <Box className="mb-4">
        <a
          onClick={(e) => {
            e.preventDefault()
            clickShowModal(true)
          }}
          href={'#'}
          style={{ color: '#1677ff' }}
          className="back-button">
          <DoubleLeftOutlined style={{ fontSize: '14px' }} />
          <span style={{ marginLeft: '6px', fontSize: '14px' }}>{t('trace.backList')}</span>
        </a>
      </Box>
      <Text style={{ fontWeight: 'bold', fontSize: 14 }}>{t('trace.spanDetail')}</Text>
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>ID: </Text>
        <Text>{node.id}</Text>
      </Box>
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.name')}: </Text>
        <Text>{node.name}</Text>
      </Box>
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.tag')}: </Text>
        <Text>{String(node.attributes?.tags || '')}</Text>
      </Box>
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.startTime')}: </Text>
        <Text>{formatDate(node.startTime)}</Text>
      </Box>
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.endTime')}: </Text>
        <Text>{formatDate(node.endTime)}</Text>
      </Box>
      {node.usage && (
        <Box padding={0}>
          <Text style={{ fontWeight: 'bold' }}>{t('trace.tokenUsage')}: </Text>
          <Text style={{ color: 'red' }}>{`↑${node.usage.prompt_tokens}`}</Text>&nbsp;
          <Text style={{ color: 'green' }}>{`↓${node.usage.completion_tokens}`}</Text>
        </Box>
      )}
      <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.spendTime')}: </Text>
        <Text>{usedTime}</Text>
      </Box>
      {/* <Box padding={0}>
        <Text style={{ fontWeight: 'bold' }}>{t('trace.parentId')}: </Text>
        <Text>{node.parentId}</Text>
      </Box> */}
      <Box className="relative my-[15px]">
        <Button
          className={`content-button ${activeTab === 'inputs' ? 'active' : ''}`}
          onClick={() => setActiveTab('inputs')}>
          {t('trace.inputs')}
        </Button>
        <Button
          className={`content-button ${activeTab === 'outputs' ? 'active' : ''}`}
          onClick={() => setActiveTab('outputs')}>
          {t('trace.outputs')}
        </Button>
        <Button className={`content-button ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => setActiveTab('raw')}>
          {t('message.tools.raw')}
        </Button>
      </Box>
      <Box className="code-container">
        {isJson ? (
          <ReactJson
            src={jsonData || ''}
            displayDataTypes={false}
            displayObjectSize={false}
            indentWidth={2}
            collapseStringsAfterLength={100}
            name={false}
            theme={'colors'}
            style={{ fontSize: '12px' }}
          />
        ) : (
          <pre
            style={{
              color: 'white',
              background: '#181c20',
              padding: '12px',
              borderRadius: 0,
              fontSize: 12,
              overflowX: 'auto',
              marginTop: '2px'
            }}>
            <code className="code-context">{`${typeof jsonData === 'object' ? JSON.stringify(jsonData, null, 2) : String(jsonData)}`}</code>
          </pre>
        )}
      </Box>
    </Box>
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
