// 通用工具组件 - 减少重复代码

import { LoadingIcon } from '@renderer/components/Icons'
import type { MCPToolResponseStatus } from '@renderer/types'
import { formatFileSize } from '@renderer/utils/file'
import { Skeleton } from 'antd'
import { Check, Ellipsis, TriangleAlert, X } from 'lucide-react'
import { createContext, type ReactNode, use } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export { default as ToolHeader, type ToolHeaderProps } from '../ToolHeader'

// Streaming context - 用于传递流式状态给子组件
export const StreamingContext = createContext<boolean>(false)
export const useIsStreaming = () => use(StreamingContext)

export function SkeletonSpan({ width = '60px' }: { width?: string }) {
  return (
    <Skeleton.Input
      active
      size="small"
      style={{
        width,
        minWidth: width,
        height: '1em',
        verticalAlign: 'middle'
      }}
    />
  )
}

/**
 * SkeletonValue - 流式时显示 skeleton，否则显示值
 */
export function SkeletonValue({
  value,
  width = '60px',
  fallback
}: {
  value: ReactNode
  width?: string
  fallback?: ReactNode
}) {
  const isStreaming = useIsStreaming()

  if (value !== undefined && value !== null && value !== '') {
    return <>{value}</>
  }

  if (isStreaming) {
    return <SkeletonSpan width={width} />
  }

  return <>{fallback ?? ''}</>
}

// 纯字符串输入工具 (Task, Bash, Search)
export function StringInputTool({
  input,
  label,
  className = ''
}: {
  input: string
  label: string
  className?: string
}) {
  return (
    <div className={className}>
      <div>{label}:</div>
      <div>{input}</div>
    </div>
  )
}

// 单字段输入工具 (pattern, query, file_path 等)
export function SimpleFieldInputTool({
  input,
  label,
  fieldName,
  className = ''
}: {
  input: Record<string, any>
  label: string
  fieldName: string
  className?: string
}) {
  return (
    <div className={className}>
      <div>{label}:</div>
      <div>
        <div>{input[fieldName]}</div>
        {/* 显示其他字段（如 Grep 的 output_mode） */}
        {Object.entries(input)
          .filter(([key]) => key !== fieldName)
          .map(([key, value]) => (
            <span key={key}>
              {key}: {String(value)}
            </span>
          ))}
      </div>
    </div>
  )
}

// 字符串输出工具 (Read, Bash, Search, Glob, WebSearch, Grep 等)
export function StringOutputTool({
  output,
  label,
  className = '',
  textColor = ''
}: {
  output: string
  label: string
  className?: string
  textColor?: string
}) {
  return (
    <div className={className}>
      <div className={textColor}>{label}:</div>
      <div>{output}</div>
    </div>
  )
}

// ToolStatus extends MCPToolResponseStatus with UI-derived statuses
// 'waiting' is a UI status derived from 'pending' + needs approval
export type ToolStatus = MCPToolResponseStatus | 'waiting'

/**
 * Convert raw data layer status to UI display status
 * @param status - Raw status from MCPToolResponseStatus
 * @param isWaiting - Whether the tool is waiting for user approval
 * @returns The effective UI status
 */
export function getEffectiveStatus(status: MCPToolResponseStatus | undefined, isWaiting: boolean): ToolStatus {
  if (status === 'pending') {
    return isWaiting ? 'waiting' : 'invoking'
  }
  return status ?? 'pending'
}

// 工具状态指示器 - 显示在 Collapse 标题右侧
export function ToolStatusIndicator({ status, hasError = false }: { status: ToolStatus; hasError?: boolean }) {
  const { t } = useTranslation()

  const getStatusInfo = (): { label: string; icon: ReactNode; color: StatusColor } | null => {
    switch (status) {
      case 'streaming':
        return { label: t('message.tools.streaming', 'Streaming'), icon: <LoadingIcon />, color: 'primary' }
      case 'waiting':
        return { label: t('message.tools.pending', 'Awaiting Approval'), icon: <LoadingIcon />, color: 'warning' }
      case 'pending':
      case 'invoking':
        return { label: t('message.tools.invoking'), icon: <LoadingIcon />, color: 'primary' }
      case 'cancelled':
        return {
          label: t('message.tools.cancelled'),
          icon: <X size={13} className="lucide-custom" />,
          color: 'error'
        }
      case 'done':
        return hasError
          ? {
              label: t('message.tools.error'),
              icon: <TriangleAlert size={13} className="lucide-custom" />,
              color: 'error'
            }
          : {
              label: t('message.tools.completed'),
              icon: <Check size={13} className="lucide-custom" />,
              color: 'success'
            }
      case 'error':
        return {
          label: t('message.tools.error'),
          icon: <TriangleAlert size={13} className="lucide-custom" />,
          color: 'error'
        }
      default:
        return null
    }
  }

  const info = getStatusInfo()
  if (!info) return null

  return (
    <StatusIndicatorContainer $color={info.color}>
      {info.label}
      {info.icon}
    </StatusIndicatorContainer>
  )
}

export type StatusColor = 'primary' | 'success' | 'warning' | 'error'

function getStatusColor(color: StatusColor): string {
  switch (color) {
    case 'primary':
    case 'success':
      return 'var(--color-primary)'
    case 'warning':
      return 'var(--color-status-warning, #faad14)'
    case 'error':
      return 'var(--color-status-error, #ff4d4f)'
    default:
      return 'var(--color-text)'
  }
}

export const StatusIndicatorContainer = styled.span<{ $color: StatusColor }>`
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0.85;
  color: ${(props) => getStatusColor(props.$color)};
`

export function TruncatedIndicator({ originalLength }: { originalLength: number }) {
  const { t } = useTranslation()
  const sizeStr = formatFileSize(originalLength)

  return (
    <div className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
      <Ellipsis size={14} />
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
        {t('message.tools.truncated', { defaultValue: sizeStr, size: sizeStr })}
      </span>
    </div>
  )
}
