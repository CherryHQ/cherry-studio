import { CircularProgress, Flex, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useTimer } from '@renderer/hooks/useTimer'
import type { McpToolResponse } from '@renderer/types/mcpTool'
import { ShieldCheck } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useMessageRenderConfig,
  useOptionalMessageListActions,
  useOptionalMessageListUi
} from '../../MessageListProvider'
import { useToolApproval } from '../hooks/useToolApproval'
import { ArgKey, ArgsSection, ArgsSectionTitle, ArgsTable, ArgValue, ResponseSection } from '../shared/ArgsTable'
import { getEffectiveStatus, SkeletonSpan, ToolStatusIndicator, TruncatedIndicator } from '../shared/GenericTools'
import { ToolDisclosure, type ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'

interface Props {
  toolResponse: McpToolResponse
}

const TOOL_RESPONSE_RENDER_DELAY_MS = 40
const TOOL_ARGS_RENDER_DELAY_MS = 120
const TOOL_RESPONSE_HIGHLIGHT_DELAY_MS = 220
const MAX_ARG_STRING_PARSE_LENGTH = 20000
const MAX_ARG_VALUE_LENGTH = 4000
const MAX_ARG_OBJECT_KEYS = 24
const MAX_ARG_ARRAY_ITEMS = 24
const logger = loggerService.withContext('MessageTools')

const MessageMcpTool: FC<Props> = ({ toolResponse }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const { t } = useTranslation()
  const { messageFont, fontSize } = useMessageRenderConfig()
  const [progress, setProgress] = useState<number>(0)
  const { setTimeoutTimer } = useTimer()
  const actions = useOptionalMessageListActions()
  const copyText = actions?.copyText
  const notifyError = actions?.notifyError
  const subscribeToolProgress = actions?.subscribeToolProgress
  const { isToolAutoApproved } = useOptionalMessageListUi() ?? {}

  // Use the unified approval hook
  const { id, tool, status, response, partialArguments } = toolResponse
  const approval = useToolApproval(toolResponse, tool)
  const autoApproved = isToolAutoApproved?.(tool) ?? false
  const isDone = status === 'done'
  const isError = status === 'error'
  const isStreaming = status === 'streaming'
  const willAwaitApproval = approval.isWaiting || (!autoApproved && status === 'invoking')

  useEffect(() => {
    const unsubscribe = subscribeToolProgress?.(id, setProgress)
    return () => {
      setProgress(0)
      unsubscribe?.()
    }
  }, [id, subscribeToolProgress])

  // Auto-expand when streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming) {
      // Expand when streaming starts
      setActiveKeys((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } else if (isDone || isError) {
      // Collapse when streaming ends
      setActiveKeys((prev) => prev.filter((key) => key !== id))
    }
  }, [isStreaming, isDone, isError, id])

  if (approval.isWaiting) {
    return null
  }

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const copyContent = (content: string, toolId: string) => {
    if (!copyText) return
    Promise.resolve(copyText(content, { successMessage: t('message.copied') }))
      .then(() => {
        setCopiedMap((prev) => ({ ...prev, [toolId]: true }))
        setTimeoutTimer('copyContent', () => setCopiedMap((prev) => ({ ...prev, [toolId]: false })), 2000)
      })
      .catch((error) => {
        logger.error('Failed to copy tool response:', error as Error)
        notifyError?.(t('message.copy.failed'))
      })
  }

  // Format tool responses for collapse items
  const getDisclosureItems = (): ToolDisclosureItem[] => {
    const items: ToolDisclosureItem[] = []
    const hasError = response?.isError === true
    const result = {
      params: toolResponse.arguments,
      response: toolResponse.response
    }
    items.push({
      key: id,
      label: (
        <MessageTitleLabel>
          <TitleContent>
            <ToolName className="min-w-0 items-center gap-1">
              <span className="truncate">
                {tool.serverName} : {tool.name}
              </span>
            </ToolName>
            <TitleActions>
              {progress > 0 ? (
                <CircularProgress value={Number((progress * 100)?.toFixed(0))} size={13} strokeWidth={2} />
              ) : (
                <ToolStatusIndicator status={getEffectiveStatus(status, willAwaitApproval)} hasError={hasError} />
              )}
              {autoApproved && (
                <Tooltip content={t('message.tools.autoApproveEnabled')}>
                  <span
                    aria-label={t('message.tools.autoApproveEnabled')}
                    className="flex h-5 items-center text-success">
                    <ShieldCheck aria-hidden="true" size={13} strokeWidth={1.8} />
                  </span>
                </Tooltip>
              )}
              {(isDone || isError) && copyText && (
                <Tooltip content={t('common.copy')} delay={500}>
                  <ActionButton
                    className="message-action-button invisible opacity-0 transition-opacity duration-150 focus-visible:visible focus-visible:opacity-100 group-hover/tool:visible group-hover/tool:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyContent(JSON.stringify(result, null, 2), id)
                    }}
                    aria-label={t('common.copy')}>
                    {copiedMap[id] ? t('common.copied') : t('common.copy')}
                  </ActionButton>
                </Tooltip>
              )}
            </TitleActions>
          </TitleContent>
        </MessageTitleLabel>
      ),
      children: (
        <ToolResponseContainer
          style={{
            fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
            fontSize
          }}>
          <ToolResponseContent
            isExpanded={activeKeys.includes(id)}
            args={isStreaming ? partialArguments : toolResponse.arguments}
            isStreaming={!!isStreaming}
            response={isDone || isError ? toolResponse.response : undefined}
          />
        </ToolResponseContainer>
      )
    })

    return items
  }

  return (
    <ToolContainer>
      <CollapseContainer
        variant="light"
        activeKey={activeKeys}
        onActiveKeyChange={handleCollapseChange}
        className="message-tools-container"
        items={getDisclosureItems()}
      />
    </ToolContainer>
  )
}

type ExtractedContent = {
  text: string
  images: Array<{ data: string; mimeType: string }>
}

/**
 * Extract preview content from MCP tool response using SDK schema
 */
const extractPreviewContent = (response: unknown): ExtractedContent => {
  if (!response) return { text: '', images: [] }

  const result = CallToolResultSchema.safeParse(response)
  if (result.success) {
    const contents = result.data.content
    if (contents.length === 0) return { text: '', images: [] }

    const textParts: string[] = []
    const images: Array<{ data: string; mimeType: string }> = []
    for (const content of contents) {
      switch (content.type) {
        case 'text':
          if (content.text) {
            try {
              const parsed = JSON.parse(content.text)
              textParts.push(JSON.stringify(parsed, null, 2))
            } catch {
              textParts.push(content.text)
            }
          }
          break
        case 'image':
          if (content.data) {
            images.push({ data: content.data, mimeType: content.mimeType ?? 'image/png' })
          }
          break
        case 'resource':
          textParts.push(`[Resource: ${content.resource?.uri ?? 'unknown'}]`)
          break
      }
    }
    return { text: textParts.join('\n\n'), images }
  }

  // Fallback: return JSON string for unknown format
  return { text: JSON.stringify(response, null, 2), images: [] }
}

const truncateArgText = (text: string): string => {
  const result = truncateOutput(text, MAX_ARG_VALUE_LENGTH)
  return result.isTruncated ? `${result.data}\n... truncated (${result.originalLength} chars)` : result.data
}

const formatArgPreviewValue = (value: unknown, depth = 0): string => {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return truncateArgText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return value.toString()

  if (depth >= 2) {
    if (Array.isArray(value)) return `[${value.length} items]`
    return '{...}'
  }

  if (Array.isArray(value)) {
    const visibleItems = value.slice(0, MAX_ARG_ARRAY_ITEMS).map((item) => formatArgPreviewValue(item, depth + 1))
    const suffix = value.length > MAX_ARG_ARRAY_ITEMS ? `, ... ${value.length - MAX_ARG_ARRAY_ITEMS} more items` : ''
    return `[${visibleItems.join(', ')}${suffix}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const visibleEntries = entries.slice(0, MAX_ARG_OBJECT_KEYS).map(([key, item]) => {
      return `${JSON.stringify(key)}: ${formatArgPreviewValue(item, depth + 1)}`
    })
    const suffix = entries.length > MAX_ARG_OBJECT_KEYS ? `, ... ${entries.length - MAX_ARG_OBJECT_KEYS} more keys` : ''
    return `{${visibleEntries.join(', ')}${suffix}}`
  }

  return truncateArgText(String(value))
}

const ToolResponseContent: FC<{
  isExpanded: boolean
  args: string | Record<string, unknown> | Record<string, unknown>[] | undefined
  isStreaming: boolean
  response?: unknown
}> = ({ isExpanded, args, isStreaming, response }) => {
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!isExpanded) {
      setShouldRender(false)
      return
    }

    const timer = window.setTimeout(() => setShouldRender(true), TOOL_RESPONSE_RENDER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isExpanded])

  if (!isExpanded || !shouldRender) return null

  return <ExpandedToolResponseContent args={args} isStreaming={isStreaming} response={response} />
}

// Unified tool response content component
const ExpandedToolResponseContent: FC<{
  args: string | Record<string, unknown> | Record<string, unknown>[] | undefined
  isStreaming: boolean
  response?: unknown
}> = ({ args, isStreaming, response }) => {
  const { highlightCode } = useCodeStyle()
  const [showArgs, setShowArgs] = useState(false)
  const [showResponse, setShowResponse] = useState(false)
  const [highlightedResponse, setHighlightedResponse] = useState<string>('')
  const [responseImages, setResponseImages] = useState<Array<{ data: string; mimeType: string }>>([])
  const [isTruncated, setIsTruncated] = useState(false)
  const [originalLength, setOriginalLength] = useState(0)

  useEffect(() => {
    const argsTimer = window.setTimeout(() => setShowArgs(true), TOOL_ARGS_RENDER_DELAY_MS)
    const responseTimer = window.setTimeout(() => setShowResponse(true), TOOL_RESPONSE_HIGHLIGHT_DELAY_MS)

    return () => {
      window.clearTimeout(argsTimer)
      window.clearTimeout(responseTimer)
    }
  }, [])

  // Parse args if it's a string (streaming partial JSON)
  const parsedArgs = useMemo(() => {
    if (!showArgs) return null
    if (!args) return null
    if (typeof args === 'string') {
      if (args.length > MAX_ARG_STRING_PARSE_LENGTH) {
        return { arguments: truncateArgText(args) }
      }
      try {
        return parsePartialJson(args)
      } catch {
        return { arguments: truncateArgText(args) }
      }
    }
    return args
  }, [args, showArgs])

  // Extract and highlight response when available
  useEffect(() => {
    if (!showResponse || !response) return

    let cancelled = false

    const highlight = async () => {
      setHighlightedResponse('')
      setResponseImages([])
      setIsTruncated(false)
      setOriginalLength(0)
      const { text: previewContent, images } = extractPreviewContent(response)
      if (cancelled) return
      setResponseImages(images)
      const {
        data: truncatedContent,
        isTruncated: wasTruncated,
        originalLength: origLen
      } = truncateOutput(previewContent)
      if (cancelled) return
      setIsTruncated(wasTruncated)
      setOriginalLength(origLen)
      const result = await highlightCode(truncatedContent, 'json')
      if (cancelled) return
      setHighlightedResponse(result)
    }

    if (window.requestIdleCallback) {
      const idleId = window.requestIdleCallback(() => void highlight(), { timeout: 500 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    const timer = window.setTimeout(() => void highlight(), 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [showResponse, response, highlightCode])

  // Handle both object and array args - for arrays, show as single entry
  const getEntries = (): Array<[string, unknown]> => {
    if (!parsedArgs || typeof parsedArgs !== 'object') return []
    if (Array.isArray(parsedArgs)) {
      return [['arguments', parsedArgs]]
    }
    return Object.entries(parsedArgs)
  }
  const entries = getEntries()

  const renderArgsTable = (): React.ReactNode => {
    if (entries.length === 0) return null
    return (
      <ArgsSection>
        <ArgsSectionTitle>Arguments</ArgsSectionTitle>
        <ArgsTable>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <ArgKey>{key}</ArgKey>
                <ArgValue>{formatArgPreviewValue(value)}</ArgValue>
              </tr>
            ))}
            {isStreaming && (
              <tr>
                <ArgKey>
                  <SkeletonSpan width="60px" />
                </ArgKey>
                <ArgValue>
                  <SkeletonSpan width="120px" />
                </ArgValue>
              </tr>
            )}
          </tbody>
        </ArgsTable>
      </ArgsSection>
    )
  }

  return (
    <div>
      {/* Arguments Table */}
      {renderArgsTable()}

      {/* Response */}
      {response !== undefined && response !== null && (highlightedResponse || responseImages.length > 0) && (
        <ResponseSection>
          <ArgsSectionTitle>Response</ArgsSectionTitle>
          {highlightedResponse && (
            <MarkdownContainer className="markdown" dangerouslySetInnerHTML={{ __html: highlightedResponse }} />
          )}
          {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          {responseImages.map((img, idx) => (
            <img
              key={idx}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt="Tool output"
              style={{ maxWidth: 300, borderRadius: 4, marginTop: 8 }}
            />
          ))}
        </ResponseSection>
      )}
    </div>
  )
}

const CollapseContainer = ({ className, ...props }: ComponentPropsWithoutRef<typeof ToolDisclosure>) => (
  <ToolDisclosure
    className={[
      'border-none [--status-color-error:var(--color-foreground-secondary)] [--status-color-invoking:var(--color-primary)] [--status-color-success:var(--color-primary,green)] [--status-color-warning:var(--color-warning,#faad14)]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ToolContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['group/tool my-px first:mt-0 first:pt-0', className].filter(Boolean).join(' ')} {...props} />
)

const MarkdownContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['[&_pre]:bg-transparent! [&_pre_span]:whitespace-pre-wrap', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const MessageTitleLabel = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-w-0 max-w-full flex-row items-center justify-between gap-2 overflow-hidden p-0', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const TitleContent = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden leading-5', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ToolName = ({ className, ...props }: ComponentPropsWithoutRef<typeof Flex>) => (
  <Flex
    className={[
      'min-w-0 max-w-full shrink overflow-hidden font-normal text-[13px] text-foreground-secondary transition-colors duration-150 group-hover/tool:text-foreground',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const TitleActions = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex shrink-0 items-center gap-1.5', className].filter(Boolean).join(' ')} {...props} />
)

const ActionButton = ({ className, onKeyDown, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    role="button"
    tabIndex={0}
    className={[
      'flex h-5 cursor-pointer items-center justify-center rounded border-none bg-transparent px-1 text-[11px] text-foreground-secondary opacity-70 transition-all duration-200 hover:bg-(--color-accent) hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-(--color-primary) focus-visible:outline-2 focus-visible:outline-offset-2',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.currentTarget.click()
    }}
    {...props}
  />
)

const ToolResponseContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['relative max-h-[300px] overflow-auto rounded-none border-t-0', className].filter(Boolean).join(' ')}
    {...props}
  />
)

export default memo(MessageMcpTool)
