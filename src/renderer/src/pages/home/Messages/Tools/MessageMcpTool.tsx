import { Flex } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { CopyIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useIsToolAutoApproved } from '@renderer/hooks/useMCPServers'
import { useTimer } from '@renderer/hooks/useTimer'
import type { MCPToolResponse } from '@renderer/types'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { Collapse, ConfigProvider, Progress } from 'antd'
import { Check, ChevronRight, ShieldCheck } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToolApproval } from './hooks/useToolApproval'
import {
  getEffectiveStatus,
  SkeletonSpan,
  ToolStatusIndicator,
  TruncatedIndicator
} from './MessageAgentTools/GenericTools'
import {
  ArgKey,
  ArgsSection,
  ArgsSectionTitle,
  ArgsTable,
  ArgValue,
  formatArgValue,
  ResponseSection
} from './shared/ArgsTable'
import { truncateOutput } from './shared/truncateOutput'
import ToolApprovalActionsComponent from './ToolApprovalActions'

interface Props {
  toolResponse: MCPToolResponse
}

const logger = loggerService.withContext('MessageTools')

const MessageMcpTool: FC<Props> = ({ toolResponse }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const { t } = useTranslation()
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [progress, setProgress] = useState<number>(0)
  const { setTimeoutTimer } = useTimer()

  // Use the unified approval hook
  const approval = useToolApproval(toolResponse)

  const { id, tool, status, response, partialArguments } = toolResponse
  const autoApproved = useIsToolAutoApproved(tool)
  const isPending = status === 'pending'
  const isDone = status === 'done'
  const isError = status === 'error'
  const isStreaming = status === 'streaming'
  const willAwaitApproval = approval.isWaiting || (!autoApproved && status === 'invoking')

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(
      IpcChannel.Mcp_Progress,
      (_event: Electron.IpcRendererEvent, data: MCPProgressEvent) => {
        // Only update progress if this event is for our specific tool call
        if (data.callId === id) {
          setProgress(data.progress)
        }
      }
    )
    return () => {
      setProgress(0)
      removeListener()
    }
  }, [id])

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

  const copyContent = (content: string, toolId: string) => {
    void navigator.clipboard.writeText(content)
    window.toast.success({ title: t('message.copied'), key: 'copy-message' })
    setCopiedMap((prev) => ({ ...prev, [toolId]: true }))
    setTimeoutTimer('copyContent', () => setCopiedMap((prev) => ({ ...prev, [toolId]: false })), 2000)
  }

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const handleAbortTool = async () => {
    if (toolResponse?.id) {
      try {
        const success = await window.api.mcp.abortTool(toolResponse.id)
        if (success) {
          window.toast.success(t('message.tools.aborted'))
        } else {
          window.toast.error(t('message.tools.abort_failed'))
        }
      } catch (error) {
        logger.error('Failed to abort tool:', error as Error)
        window.toast.error(t('message.tools.abort_failed'))
      }
    }
  }

  // Format tool responses for collapse items
  const getCollapseItems = (): { key: string; label: React.ReactNode; children: React.ReactNode }[] => {
    const items: { key: string; label: React.ReactNode; children: React.ReactNode }[] = []
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
            <ToolName className="items-center gap-1">
              {tool.serverName} : {tool.name}
              {autoApproved && (
                <Tooltip content={t('message.tools.autoApproveEnabled')}>
                  <ShieldCheck size={14} color="var(--status-color-success)" />
                </Tooltip>
              )}
            </ToolName>
          </TitleContent>
          <ActionButtonsContainer>
            {progress > 0 ? (
              <Progress type="circle" size={14} percent={Number((progress * 100)?.toFixed(0))} />
            ) : (
              <ToolStatusIndicator status={getEffectiveStatus(status, willAwaitApproval)} hasError={hasError} />
            )}
            {!isPending && (
              <Tooltip content={t('common.copy')} delay={500}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyContent(JSON.stringify(result, null, 2), id)
                  }}
                  aria-label={t('common.copy')}>
                  {!copiedMap[id] && <CopyIcon size={14} />}
                  {copiedMap[id] && <Check size={14} color="var(--status-color-success)" />}
                </ActionButton>
              </Tooltip>
            )}
          </ActionButtonsContainer>
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
    <>
      <ConfigProvider
        theme={{
          components: {
            Button: {
              borderRadiusSM: 6
            }
          }
        }}>
        <ToolContainer>
          <ToolContentWrapper className={isPending || approval.isWaiting ? 'pending' : status}>
            <CollapseContainer
              ghost
              activeKey={activeKeys}
              size="small"
              onChange={handleCollapseChange}
              className="message-tools-container"
              items={getCollapseItems()}
              expandIconPosition="end"
              expandIcon={({ isActive }) => (
                <ExpandIcon $isActive={isActive} size={18} color="var(--color-text-3)" strokeWidth={1.5} />
              )}
            />
            {(isPending || approval.isWaiting || approval.isExecuting) && (
              <ActionsBar>
                <ActionLabel>
                  {willAwaitApproval
                    ? t('settings.mcp.tools.autoApprove.tooltip.confirm')
                    : t('message.tools.invoking')}
                </ActionLabel>

                <ToolApprovalActionsComponent
                  {...approval}
                  showAbort={approval.isExecuting && !!toolResponse?.id}
                  onAbort={handleAbortTool}
                />
              </ActionsBar>
            )}
          </ToolContentWrapper>
        </ToolContainer>
      </ConfigProvider>
    </>
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

// Unified tool response content component
const ToolResponseContent: FC<{
  isExpanded: boolean
  args: string | Record<string, unknown> | Record<string, unknown>[] | undefined
  isStreaming: boolean
  response?: unknown
}> = ({ isExpanded, args, isStreaming, response }) => {
  const { highlightCode } = useCodeStyle()
  const [highlightedResponse, setHighlightedResponse] = useState<string>('')
  const [responseImages, setResponseImages] = useState<Array<{ data: string; mimeType: string }>>([])
  const [isTruncated, setIsTruncated] = useState(false)
  const [originalLength, setOriginalLength] = useState(0)

  // Parse args if it's a string (streaming partial JSON)
  const parsedArgs = useMemo(() => {
    if (!args) return null
    if (typeof args === 'string') {
      try {
        return parsePartialJson(args)
      } catch {
        return null
      }
    }
    return args
  }, [args])

  // Extract and highlight response when available
  useEffect(() => {
    if (!isExpanded || !response) return

    const highlight = async () => {
      const { text: previewContent, images } = extractPreviewContent(response)
      setResponseImages(images)
      const {
        data: truncatedContent,
        isTruncated: wasTruncated,
        originalLength: origLen
      } = truncateOutput(previewContent)
      setIsTruncated(wasTruncated)
      setOriginalLength(origLen)
      const result = await highlightCode(truncatedContent, 'json')
      setHighlightedResponse(result)
    }

    const timer = setTimeout(highlight, 0)
    return () => clearTimeout(timer)
  }, [isExpanded, response, highlightCode])

  if (!isExpanded) return null

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
                <ArgValue>{formatArgValue(value)}</ArgValue>
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

const ToolContentWrapper = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      'overflow-hidden rounded-lg p-px [&.pending]:bg-(--color-background-soft) [&.pending_.ant-collapse]:border-none [&_.ant-collapse]:border [&_.ant-collapse]:border-(--color-border)',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ActionsBar = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-row items-center justify-between p-2', className].filter(Boolean).join(' ')} {...props} />
)

const ActionLabel = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--color-text-2) text-sm', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ExpandIcon = ({
  $isActive,
  style,
  ...props
}: ComponentPropsWithoutRef<typeof ChevronRight> & { $isActive?: boolean }) => (
  <ChevronRight
    className="transition-transform duration-200"
    style={{ transform: $isActive ? 'rotate(90deg)' : 'rotate(0deg)', ...style }}
    {...props}
  />
)

const CollapseContainer = ({ className, ...props }: ComponentPropsWithoutRef<typeof Collapse>) => (
  <Collapse
    className={[
      '[&_.ant-collapse-header]:items-center! overflow-hidden rounded-[7px] border-none bg-(--color-background) [--status-color-error:var(--color-status-error,#ff4d4f)] [--status-color-invoking:var(--color-primary)] [--status-color-success:var(--color-primary,green)] [--status-color-warning:var(--color-status-warning,#faad14)] [&_.ant-collapse-content-box]:p-0! [&_.ant-collapse-header]:px-2.5! [&_.ant-collapse-header]:py-2!',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ToolContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['my-2.5 first:mt-0 first:pt-0', className].filter(Boolean).join(' ')} {...props} />
)

const MarkdownContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['[&_pre]:bg-transparent! [&_pre_span]:whitespace-pre-wrap', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const MessageTitleLabel = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['ml-1 flex w-full flex-row items-center justify-between gap-2.5 p-0', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const TitleContent = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-row items-center gap-2', className].filter(Boolean).join(' ')} {...props} />
)

const ToolName = ({ className, ...props }: ComponentPropsWithoutRef<typeof Flex>) => (
  <Flex className={['font-medium text-(--color-text) text-[13px]', className].filter(Boolean).join(' ')} {...props} />
)

const ActionButtonsContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['ml-auto flex items-center gap-1.5', className].filter(Boolean).join(' ')} {...props} />
)

const ActionButton = ({ className, ...props }: ComponentPropsWithoutRef<'button'>) => (
  <button
    type="button"
    className={[
      'flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1 rounded border-none bg-transparent p-1 text-(--color-text-2) opacity-70 transition-all duration-200 hover:bg-(--color-bg-3) hover:text-(--color-text) hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-(--color-primary) focus-visible:outline-2 focus-visible:outline-offset-2 [&.confirm-button:hover]:bg-(--color-primary-bg) [&.confirm-button:hover]:text-(--color-primary) [&.confirm-button]:text-(--color-primary) [&_.iconfont]:text-sm',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ToolResponseContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['relative max-h-[300px] overflow-auto rounded-b border-t-0', className].filter(Boolean).join(' ')}
    {...props}
  />
)

export default memo(MessageMcpTool)
