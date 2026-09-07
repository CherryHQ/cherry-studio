import { Badge } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { McpServerLogEntry } from '@shared/types/mcp'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatMcpLogData, formatMcpLogs } from './utils'

const logger = loggerService.withContext('McpLogsTab')

interface McpLogsTabProps {
  serverId: string
}

const McpLogsTab = ({ serverId }: McpLogsTabProps) => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<(McpServerLogEntry & { serverId?: string })[]>([])
  const logsText = useMemo(() => formatMcpLogs(logs), [logs])

  useEffect(() => {
    let disposed = false
    const unsubscribe = ipcApi.on('mcp.server.log', (log) => {
      if (log.serverId !== serverId) return
      setLogs((current) => appendServerLog(current, log))
    })

    const loadHistory = async () => {
      try {
        const history = await ipcApi.request('mcp.server.get_logs', { serverId })
        if (!disposed) {
          setLogs((current) => mergeServerLogs(history, current))
        }
      } catch (error) {
        logger.warn('Failed to load server logs', error as Error)
      }
    }

    void loadHistory()

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [serverId])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground-tertiary text-sm">
          {t('settings.mcp.logsHint', 'Logs from the MCP server process')}
        </span>
        <CopyButton
          textToCopy={logsText}
          size={14}
          successFeedback="icon"
          disabled={logs.length === 0}
          tooltip={t('settings.mcp.copyLogs', 'Copy logs')}
        />
      </div>
      <LogList className="selectable pt-0">
        {logs.length === 0 && (
          <span className="text-foreground-tertiary text-sm">{t('settings.mcp.noLogs', 'No logs yet')}</span>
        )}
        {logs.map((log, index) => (
          <LogItem key={`${log.timestamp}-${index}`}>
            <LogHeader>
              <Timestamp>{new Date(log.timestamp).toLocaleTimeString()}</Timestamp>
              <Badge variant="outline" className={mapLogLevelClass(log.level)}>
                {log.level}
              </Badge>
              <LogMessage>{log.message}</LogMessage>
            </LogHeader>
            {log.data && <PreBlock>{formatMcpLogData(log.data)}</PreBlock>}
          </LogItem>
        ))}
      </LogList>
    </div>
  )
}

const LogList = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-3 pt-1.25 pb-3.75', className)} {...props} />
)

const LogItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground', className)}
    {...props}
  />
)

const LogHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-wrap items-baseline gap-2', className)} {...props} />
)

const Timestamp = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('shrink-0 text-foreground-tertiary text-xs', className)} {...props} />
)

const LogMessage = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('wrap-break-word text-[13px] leading-normal', className)} {...props} />
)

const PreBlock = ({ className, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
  <pre
    className={cn(
      'wrap-break-word mt-1.5 whitespace-pre-wrap rounded-md border border-border bg-background px-2 py-2 text-foreground text-xs',
      className
    )}
    {...props}
  />
)

function mapLogLevelClass(level: McpServerLogEntry['level']) {
  switch (level) {
    case 'error':
    case 'stderr':
      return 'border-error-border bg-error-subtle text-error-subtle-foreground'
    case 'warn':
      return 'border-warning-border bg-warning-subtle text-warning-subtle-foreground'
    case 'info':
    case 'stdout':
      return 'border-info-border bg-info-subtle text-info-subtle-foreground'
    default:
      return 'border-border-subtle bg-muted text-muted-foreground'
  }
}

function appendServerLog(
  current: (McpServerLogEntry & { serverId?: string })[],
  log: McpServerLogEntry & { serverId: string }
) {
  const merged = [...current, log]
  return merged.length > 200 ? merged.slice(merged.length - 200) : merged
}

function mergeServerLogs(
  history: McpServerLogEntry[],
  current: (McpServerLogEntry & { serverId?: string })[]
): (McpServerLogEntry & { serverId?: string })[] {
  const seen = new Set<string>()
  const merged: (McpServerLogEntry & { serverId?: string })[] = []

  for (const log of [...history, ...current]) {
    const key = `${log.timestamp}:${log.level}:${log.source ?? ''}:${log.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(log)
  }

  return merged.length > 200 ? merged.slice(merged.length - 200) : merged
}

export default McpLogsTab
