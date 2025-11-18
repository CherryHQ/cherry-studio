import 'katex/dist/katex.min.css'

import type { MCPServer, MCPTool } from '@renderer/types'
import { loggerService } from '@logger'
import { Button, Flex, Input, Modal, Space, Table, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, Play, Sparkles, Code as CodeIcon } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'

const logger = loggerService.withContext('ExecuteToolModal')

interface ExecuteToolModalProps {
  open: boolean
  tool: MCPTool | null
  server: MCPServer | null
  onClose: () => void
}

interface TableData {
  key: string
  name: string
  value: any
}

const ExecuteToolModal: React.FC<ExecuteToolModalProps> = ({ open, tool, server, onClose }) => {
  const { t } = useTranslation()
  const [paramsJson, setParamsJson] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ content: any[]; isError?: boolean } | null>(null)
  const [viewMode, setViewMode] = useState<'json' | 'formatted'>('json')

  // 初始化参数 JSON（基于工具的 inputSchema）
  const initialParams = useMemo(() => {
    if (!tool?.inputSchema?.properties) {
      return '{}'
    }

    const params: Record<string, any> = {}
    const properties = tool.inputSchema.properties

    // 为每个属性生成默认值或示例
    Object.keys(properties).forEach((key) => {
      const prop = properties[key]
      if (prop.type === 'string') {
        params[key] = prop.default || ''
      } else if (prop.type === 'number') {
        params[key] = prop.default || 0
      } else if (prop.type === 'boolean') {
        params[key] = prop.default || false
      } else if (prop.type === 'array') {
        params[key] = prop.default || []
      } else if (prop.type === 'object') {
        params[key] = prop.default || {}
      }
    })

    return JSON.stringify(params, null, 2)
  }, [tool])

  // 当工具改变时，重置参数
  useEffect(() => {
    if (open && tool) {
      setParamsJson(initialParams)
      setResult(null)
      setViewMode('json')
    }
  }, [open, tool, initialParams])

  // 检测文本类型
  const detectContentType = (text: string): 'json' | 'markdown' | 'html' | 'text' => {
    if (!text) return 'text'

    // 检测 HTML 特征（优先检测，因为 HTML 可能包含其他格式）
    // 检查是否包含完整的 HTML 文档结构或大量 HTML 标签
    const htmlDocumentPatterns = [
      /<!DOCTYPE\s+html/i,
      /<html[\s>]/i,
      /<head[\s>]/i,
      /<body[\s>]/i
    ]

    const hasHtmlDocument = htmlDocumentPatterns.some((pattern) => pattern.test(text))

    // 检查 HTML 标签数量
    const htmlTagPattern = /<[a-z][a-z0-9]*[\s>]/gi
    const htmlTags = text.match(htmlTagPattern)
    const htmlTagCount = htmlTags ? htmlTags.length : 0

    // 如果包含 HTML 文档结构，或者有多个 HTML 标签，认为是 HTML
    if (hasHtmlDocument || htmlTagCount >= 3) {
      return 'html'
    }

    // 尝试解析为 JSON
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null) {
        return 'json'
      }
    } catch {
      // 不是 JSON
    }

    // 检测 Markdown 特征
    const markdownPatterns = [
      /^#{1,6}\s+.+$/m, // 标题
      /^\s*[-*+]\s+.+$/m, // 列表
      /^\s*\d+\.\s+.+$/m, // 有序列表
      /\[.+\]\(.+\)/, // 链接
      /!\[.+\]\(.+\)/, // 图片
      /```[\s\S]*?```/, // 代码块
      /`[^`]+`/, // 行内代码
      /\*\*.*?\*\*/, // 粗体
      /\*.*?\*/, // 斜体
      /^>\s+.+$/m // 引用
    ]

    const hasMarkdown = markdownPatterns.some((pattern) => pattern.test(text))
    if (hasMarkdown) {
      return 'markdown'
    }

    return 'text'
  }

  // 获取主要文本内容
  const mainTextContent = useMemo(() => {
    if (!result || !result.content) return ''

    // 查找第一个 text 类型的 content
    const textContent = result.content.find((item) => item.type === 'text')
    return textContent?.text || ''
  }, [result])

  // 获取格式化的内容类型
  const formattedContentType = useMemo(() => {
    return detectContentType(mainTextContent)
  }, [mainTextContent])

  // 验证 JSON 格式
  const validateJson = (jsonStr: string): { valid: boolean; data?: any; error?: string } => {
    try {
      const data = JSON.parse(jsonStr)
      return { valid: true, data }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid JSON'
      }
    }
  }

  // 执行工具
  const handleExecute = async () => {
    if (!tool || !server) {
      message.error(t('settings.mcp.tools.execute.error.noToolOrServer', 'Tool or server not found'))
      return
    }

    // 验证 JSON
    const validation = validateJson(paramsJson)
    if (!validation.valid) {
      message.error(
        t('settings.mcp.tools.execute.error.invalidJson', 'Invalid JSON format: {{error}}', {
          error: validation.error
        })
      )
      return
    }

    setLoading(true)
    setResult(null)

    try {
      logger.info(`Executing tool: ${tool.name}`, { params: validation.data })

      const resp = await window.api.mcp.callTool({
        server,
        name: tool.name,
        args: validation.data,
        callId: `manual-${Date.now()}`
      })

      logger.info(`Tool executed successfully: ${tool.name}`, resp)
      setResult(resp)
    } catch (error) {
      logger.error(`Error executing tool: ${tool.name}`, error as Error)
      const errorMessage =
        error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error)

      setResult({
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      })
    } finally {
      setLoading(false)
    }
  }

  // 复制结果
  const handleCopy = () => {
    if (!result) return

    const resultText = JSON.stringify(result, null, 2)
    navigator.clipboard.writeText(resultText).then(
      () => {
        message.success(t('settings.mcp.tools.execute.copied', 'Copied to clipboard'))
      },
      () => {
        message.error(t('settings.mcp.tools.execute.copyFailed', 'Failed to copy'))
      }
    )
  }

  // 将结果转换为表格数据（仅当内容是 JSON 时）
  const tableData: TableData[] = useMemo(() => {
    if (!result || !result.content || formattedContentType !== 'json') return []

    const data: TableData[] = []

    try {
      const parsed = JSON.parse(mainTextContent)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // 如果是对象，展开为多行
        Object.entries(parsed).forEach(([key, value]) => {
          data.push({
            key: key,
            name: key,
            value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
          })
        })
      } else if (Array.isArray(parsed)) {
        // 如果是数组，显示索引和值
        parsed.forEach((item, idx) => {
          data.push({
            key: `item-${idx}`,
            name: String(idx),
            value: typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)
          })
        })
      }
    } catch {
      // 解析失败，返回空数组
    }

    return data
  }, [result, formattedContentType, mainTextContent])

  const tableColumns: ColumnsType<TableData> = [
    {
      title: t('settings.mcp.tools.execute.table.name', 'Name'),
      dataIndex: 'name',
      key: 'name',
      width: 200
    },
    {
      title: t('settings.mcp.tools.execute.table.value', 'Value'),
      dataIndex: 'value',
      key: 'value',
      render: (value: string) => (
        <Typography.Text
          style={{
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            fontSize: '12px',
            maxWidth: '100%',
            display: 'block'
          }}>
          {value}
        </Typography.Text>
      )
    }
  ]

  if (!tool || !server) {
    return null
  }

  return (
    <Modal
      title={
        <Flex align="center" gap={8}>
          <Play size={16} />
          <Typography.Text strong>
            {t('settings.mcp.tools.execute.title', 'Execute Tool: {{name}}', { name: tool.name })}
          </Typography.Text>
        </Flex>
      }
      open={open}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>,
        <Button key="execute" type="primary" loading={loading} onClick={handleExecute} icon={<Play size={14} />}>
          {t('settings.mcp.tools.execute.execute', 'Execute')}
        </Button>
      ]}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* 参数输入 */}
        <div>
          <Typography.Title level={5}>
            {t('settings.mcp.tools.execute.params', 'Parameters (JSON)')}
          </Typography.Title>
          <Input.TextArea
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            rows={8}
            placeholder={t('settings.mcp.tools.execute.paramsPlaceholder', 'Enter JSON parameters...')}
            style={{ fontFamily: 'monospace', fontSize: '12px' }}
          />
        </div>

        {/* 结果显示 */}
        {result && (
          <div>
            <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
              <Typography.Title level={5} style={{ margin: 0, color: result.isError ? '#ff4d4f' : undefined }}>
                {result.isError
                  ? t('settings.mcp.tools.execute.result.error', 'Error Result')
                  : t('settings.mcp.tools.execute.result.success', 'Result')}
              </Typography.Title>
              <Space>
                <Button.Group>
                  <Button
                    type={viewMode === 'json' ? 'primary' : 'default'}
                    icon={<CodeIcon size={14} />}
                    onClick={() => setViewMode('json')}
                    size="small">
                    {t('settings.mcp.tools.execute.view.json', 'JSON')}
                  </Button>
                  <Button
                    type={viewMode === 'formatted' ? 'primary' : 'default'}
                    icon={<Sparkles size={14} />}
                    onClick={() => setViewMode('formatted')}
                    size="small">
                    {t('settings.mcp.tools.execute.view.formatted', '美化')}
                  </Button>
                </Button.Group>
                <Button icon={<Copy size={14} />} onClick={handleCopy} size="small">
                  {t('settings.mcp.tools.execute.copy', 'Copy')}
                </Button>
              </Space>
            </Flex>

            {viewMode === 'json' ? (
              <Input.TextArea
                value={JSON.stringify(result, null, 2)}
                readOnly
                rows={12}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  backgroundColor: result.isError ? '#fff1f0' : '#f6ffed',
                  borderColor: result.isError ? '#ffccc7' : '#b7eb8f'
                }}
              />
            ) : (
              <div
                style={{
                  backgroundColor: result.isError ? '#fff1f0' : '#f6ffed',
                  border: `1px solid ${result.isError ? '#ffccc7' : '#b7eb8f'}`,
                  borderRadius: '4px',
                  padding: formattedContentType === 'html' ? '0' : '16px',
                  maxHeight: '500px',
                  overflow: formattedContentType === 'html' ? 'hidden' : 'auto',
                  position: 'relative'
                }}>
                {formattedContentType === 'html' ? (
                  <iframe
                    key={mainTextContent} // 强制重新创建 iframe 当内容改变时
                    srcDoc={mainTextContent}
                    title="HTML Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    style={{
                      width: '100%',
                      height: '500px',
                      border: 'none',
                      display: 'block',
                      backgroundColor: 'white'
                    }}
                  />
                ) : formattedContentType === 'json' && tableData.length > 0 ? (
                  <Table
                    columns={tableColumns}
                    dataSource={tableData}
                    pagination={false}
                    size="small"
                    scroll={{ y: 400 }}
                    style={{
                      backgroundColor: 'transparent'
                    }}
                  />
                ) : formattedContentType === 'markdown' ? (
                  <div className="markdown" style={{ wordBreak: 'break-word' }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
                      rehypePlugins={[rehypeRaw, rehypeKatex]}>
                      {mainTextContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <Typography.Paragraph
                    style={{
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      marginBottom: 0,
                      fontFamily: 'monospace',
                      fontSize: '12px'
                    }}>
                    {mainTextContent || JSON.stringify(result.content, null, 2)}
                  </Typography.Paragraph>
                )}
              </div>
            )}
          </div>
        )}
      </Space>
    </Modal>
  )
}

export default ExecuteToolModal

