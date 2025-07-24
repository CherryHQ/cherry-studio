import './Trace.css'

import { DoubleLeftOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
// import TraceModal from '@renderer/trace/TraceModal'
import { TraceModal } from '@renderer/trace/pages/TraceModel'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactJson from 'react-json-view'

import { Box, Button, Text } from './Component'
import { convertTime } from './TraceTree'

const logger = loggerService.withContext('SpanDetail')

interface SpanDetailProps {
  node: TraceModal
  clickShowModal: (input: boolean) => void
}

const SpanDetail: FC<SpanDetailProps> = ({ node, clickShowModal }) => {
  const [showInput, setShowInput] = useState(true)
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
    data = showInput ? node.attributes.inputs : node.attributes.outputs

    if (!showInput && node.status === 'ERROR') {
      data = node.events && Array.isArray(node.events) ? node.events?.find((e) => e.name === 'exception') : undefined
    }

    if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
      try {
        setJsonData(JSON.parse(data))
        setIsJson(true)
        return
      } catch {
        logger.error(`failed to parse json data: ${data}`)
      }
    } else if (typeof data === 'object' || Array.isArray(data)) {
      setJsonData(data)
      setIsJson(true)
      return
    }
    setIsJson(false)
    setJsonData(data as unknown as object)
  }, [node.attributes, node.status, node.events, showInput])

  useEffect(() => {
    setUsedTime(convertTime((node.endTime || Date.now()) - node.startTime))
    changeJsonData()
  }, [node.endTime, node.startTime, node.attributes, node.events, changeJsonData])

  useEffect(() => {
    const updateCopyButtonTitles = () => {
      const copyButtons = document.querySelectorAll('.copy-to-clipboard-container > span')
      copyButtons.forEach((btn) => {
        btn.setAttribute('title', t('code_block.copy'))
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
      <Box padding={0} style={{ marginBottom: 16 }}>
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
      <Box style={{ position: 'relative', margin: '15px 0 15px' }}>
        <Button className={`content-button ${showInput ? 'active' : ''}`} onClick={() => setShowInput(true)}>
          {t('trace.inputs')}
        </Button>
        <Button className={`content-button ${showInput ? '' : 'active'}`} onClick={() => setShowInput(false)}>
          {t('trace.outputs')}
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

export default SpanDetail
