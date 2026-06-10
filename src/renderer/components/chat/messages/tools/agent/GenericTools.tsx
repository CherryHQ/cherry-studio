import { SkeletonSpan } from '@renderer/components/Skeleton/InlineSkeleton'
import type { McpToolResponseStatus } from '@renderer/types'
import { formatFileSize } from '@renderer/utils/file'
import { Check, Ellipsis, TriangleAlert, X } from 'lucide-react'
import { type ComponentPropsWithoutRef, createContext, type ReactNode, use } from 'react'
import { useTranslation } from 'react-i18next'

export {
  getAgentToolLabel,
  getReadableToolActivity,
  getReadableToolDescription,
  type ToolActivity
} from '../toolActivity'

export const StreamingContext = createContext<boolean>(false)
export const useIsStreaming = () => use(StreamingContext)

export { SkeletonSpan }

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

export function SimpleFieldInputTool({
  input,
  label,
  fieldName,
  className = ''
}: {
  input: Record<string, unknown>
  label: string
  fieldName: string
  className?: string
}) {
  return (
    <div className={className}>
      <div>{label}:</div>
      <div>
        <div>{String(input[fieldName] ?? '')}</div>
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

export type ToolStatus = McpToolResponseStatus | 'waiting'

export function getEffectiveStatus(status: McpToolResponseStatus | undefined, isWaiting: boolean): ToolStatus {
  if (status === 'pending') {
    return isWaiting ? 'waiting' : 'invoking'
  }
  return status ?? 'pending'
}

export function ToolStatusIndicator({ status, hasError = false }: { status: ToolStatus; hasError?: boolean }) {
  const { t } = useTranslation()

  const getStatusInfo = (): { label: string; icon?: ReactNode; color: StatusColor } | null => {
    switch (status) {
      case 'streaming':
        return { label: t('message.tools.streaming', 'Streaming'), color: 'primary' }
      case 'waiting':
        return { label: t('message.tools.pending', 'Awaiting Approval'), color: 'warning' }
      case 'pending':
      case 'invoking':
        return { label: t('message.tools.invoking'), color: 'primary' }
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
      return 'var(--color-warning, #faad14)'
    case 'error':
      return 'var(--color-foreground-secondary)'
    default:
      return 'var(--color-foreground)'
  }
}

export function StatusIndicatorContainer({
  $color,
  style,
  ...props
}: ComponentPropsWithoutRef<'span'> & { $color: StatusColor }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs opacity-85"
      style={{ color: getStatusColor($color), ...style }}
      {...props}
    />
  )
}

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
