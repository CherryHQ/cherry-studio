import { Alert, Badge, Button, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { DeleteIcon } from '@renderer/components/Icons'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import { useMCPServerMutations } from '@renderer/hooks/useMCPServers'
import { useMCPServerTrust } from '@renderer/hooks/useMCPServerTrust'
import { formatMcpError } from '@renderer/utils/error'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { CircleXIcon, SquareArrowOutUpRight } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('McpServerCard')

interface McpServerCardProps {
  server: MCPServer
  isEditing?: boolean
  onEdit: () => void
}

const McpServerCard: FC<McpServerCardProps> = ({ server, isEditing = false, onEdit }) => {
  const { updateMCPServer, deleteMCPServer } = useMCPServerMutations(server.id)
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState<string | null>(null)

  const updateServerBody = useCallback((body: Partial<MCPServer>) => updateMCPServer({ body }), [updateMCPServer])

  const { ensureServerTrusted } = useMCPServerTrust(updateServerBody)
  const { t } = useTranslation()

  // Fetch version for active servers
  const fetchServerVersion = useCallback(async (s: MCPServer) => {
    if (!s.isActive) return
    try {
      const v = await window.api.mcp.getServerVersion(s)
      setVersion(v)
    } catch {
      setVersion(null)
    }
  }, [])

  useEffect(() => {
    if (server.isActive) {
      void fetchServerVersion(server)
    } else {
      setVersion(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.isActive, server.id, fetchServerVersion])

  const handleToggleActive = useCallback(
    async (active: boolean) => {
      let serverForUpdate = server
      if (active) {
        const trustedServer = await ensureServerTrusted(server)
        if (!trustedServer) return
        serverForUpdate = trustedServer
      }

      setLoading(true)
      const oldActiveState = serverForUpdate.isActive
      logger.debug('toggle activate', { serverId: serverForUpdate.id, active })
      try {
        if (active) {
          await fetchServerVersion({ ...serverForUpdate, isActive: active })
        } else {
          await window.api.mcp.stopServer(serverForUpdate)
          setVersion(null)
        }
        void updateMCPServer({ body: { isActive: active } })
      } catch (error: any) {
        window.modal.error({
          title: t('settings.mcp.startError'),
          content: formatMcpError(error),
          centered: true
        })
        void updateMCPServer({ body: { isActive: oldActiveState } })
      } finally {
        setLoading(false)
      }
    },
    [server, ensureServerTrusted, fetchServerVersion, updateMCPServer, t]
  )

  const handleDelete = useCallback(() => {
    try {
      window.modal.confirm({
        title: t('settings.mcp.deleteServer'),
        content: t('settings.mcp.deleteServerConfirm'),
        centered: true,
        onOk: async () => {
          await window.api.mcp.removeServer(server)
          await deleteMCPServer({})
          window.toast.success(t('settings.mcp.deleteSuccess'))
        }
      })
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.deleteError')}: ${error.message}`)
    }
  }, [server, deleteMCPServer, t])

  const handleOpenUrl = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()

      if (server.providerUrl) {
        window.open(server.providerUrl, '_blank')
      }
    },
    [server.providerUrl]
  )

  const sourceLabel = server.provider || (server.installSource === 'builtin' ? t('settings.mcp.builtinServers') : '')
  const typeLabel = (server.type ?? 'stdio').toUpperCase()

  const getTypeBadgeClass = () => {
    switch (server.type) {
      case 'sse':
        return 'bg-success/10 text-success'
      case 'streamableHttp':
        return 'bg-info/10 text-info'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const handleRowClick = useCallback(() => {
    onEdit()
  }, [onEdit])

  const handleToolbarClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
  }, [])

  const handleDeleteClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      handleDelete()
    },
    [handleDelete]
  )

  const isLoading = loading

  const Fallback = useCallback(
    (props: FallbackProps) => {
      const { error } = props
      const errorDetails = formatErrorMessage(error)

      const onClickDetails = () => {
        void GeneralPopup.show({
          content: (
            <div
              style={{
                padding: 8,
                textWrap: 'pretty',
                fontFamily: 'monospace',
                userSelect: 'text',
                marginRight: 20,
                color: 'var(--color-error-base)'
              }}>
              {errorDetails}
            </div>
          )
        })
      }

      return (
        <Alert
          message={t('error.boundary.mcp.invalid')}
          showIcon
          type="error"
          style={{ height: 125, alignItems: 'flex-start', padding: 12, borderRadius: 'var(--radius-lg)' }}
          description={
            <div className="line-clamp-3 text-[var(--color-error-base)] text-xs leading-5">{errorDetails}</div>
          }
          onClick={onClickDetails}
          action={
            <div className="flex items-center gap-1">
              <Button variant="destructive" size="sm" onClick={onClickDetails}>
                <Tooltip content={t('error.boundary.details')}>
                  <CircleXIcon size={16} />
                </Tooltip>
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteClick}>
                <Tooltip content={t('common.delete')}>
                  <DeleteIcon size={16} />
                </Tooltip>
              </Button>
            </div>
          }
        />
      )
    },
    [handleDeleteClick, t]
  )

  return (
    <ErrorBoundary fallbackComponent={Fallback}>
      <CardContainer onClick={handleRowClick} data-slot="mcp-server-row">
        <ServerNameCell>
          <ActiveDot $active={server.isActive} />
          {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
          <ServerNameText title={server.name} className={server.isActive ? 'text-foreground' : 'text-muted-foreground'}>
            {server.name}
          </ServerNameText>
        </ServerNameCell>

        <MutedCell>{version || '—'}</MutedCell>

        <div className="min-w-0 shrink-0">
          <MetaBadge className={getTypeBadgeClass()}>{typeLabel}</MetaBadge>
        </div>

        <SourceCell>
          {sourceLabel ? (
            <MetaBadge className={server.provider ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>
              {sourceLabel}
            </MetaBadge>
          ) : (
            <span className="text-muted-foreground/70">—</span>
          )}
          {server.providerUrl && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-md text-muted-foreground shadow-none hover:text-foreground"
              onClick={handleOpenUrl}
              data-no-dnd>
              <SquareArrowOutUpRight size={13} />
            </Button>
          )}
        </SourceCell>

        <ToolbarWrapper onClick={handleToolbarClick}>
          {isEditing && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-7 rounded-md text-muted-foreground shadow-none hover:text-destructive"
              onClick={handleDeleteClick}>
              <DeleteIcon size={14} className="lucide-custom" />
            </Button>
          )}
          <Switch
            checked={server.isActive}
            key={server.id}
            disabled={isLoading}
            size="xs"
            className="shadow-none data-[state=checked]:bg-success/85"
            onCheckedChange={handleToggleActive}
            data-no-dnd
          />
        </ToolbarWrapper>
      </CardContainer>
    </ErrorBoundary>
  )
}

const CardContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 border-border/60 border-b bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted/35',
      className
    )}
    {...props}
  />
)

const ServerNameCell = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-0 flex-1 items-center gap-2.5', className)} {...props} />
)

const ServerNameText = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('min-w-0 truncate font-semibold text-[14px] leading-5', className)} {...props} />
)

const ServerLogo = ({ className, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
  <img className={cn('size-5 shrink-0 rounded object-cover', className)} {...props} />
)

const MutedCell = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('hidden w-14 shrink-0 truncate text-muted-foreground text-sm min-[1180px]:block', className)}
    {...props}
  />
)

const SourceCell = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('hidden min-w-0 shrink-0 items-center gap-1.5 min-[1320px]:flex', className)} {...props} />
)

const ToolbarWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('ml-auto flex shrink-0 items-center justify-end gap-2', className)} {...props} />
)

const ActiveDot = ({ $active, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $active: boolean }) => (
  <div
    className={cn(
      'size-2 shrink-0 rounded-full',
      $active ? 'bg-success/85 ring-2 ring-success/15' : 'bg-muted-foreground/30',
      className
    )}
    {...props}
  />
)

const MetaBadge = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Badge>) => (
  <Badge
    variant="secondary"
    className={cn('h-5 max-w-full rounded-md border-transparent px-2 font-medium text-[11px] leading-none', className)}
    {...props}
  />
)

export default McpServerCard
