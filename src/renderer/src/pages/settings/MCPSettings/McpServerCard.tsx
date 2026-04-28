import { Alert, Button, Switch, Tooltip } from '@cherrystudio/ui'
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

  const handleOpenUrl = () => {
    if (server.providerUrl) {
      window.open(server.providerUrl, '_blank')
    }
  }

  const isLoading = loading

  const Fallback = useCallback(
    (props: FallbackProps) => {
      const { error } = props
      const errorDetails = formatErrorMessage(error)

      const ErrorDetails = () => {
        return (
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
      }

      const onClickDetails = () => {
        void GeneralPopup.show({ content: <ErrorDetails /> })
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
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  handleDelete()
                }}>
                <Tooltip content={t('common.delete')}>
                  <DeleteIcon size={16} />
                </Tooltip>
              </Button>
            </div>
          }
        />
      )
    },
    [handleDelete, t]
  )

  return (
    <ErrorBoundary fallbackComponent={Fallback}>
      <CardContainer $isActive={server.isActive} onClick={onEdit}>
        <ServerMain>
          <ActiveDot $active={server.isActive} />
          <ServerNameWrapper>
            {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
            <ServerNameText title={server.name} className={server.isActive ? 'text-foreground' : 'text-foreground/45'}>
              {server.name}
            </ServerNameText>
            {version && <InlineMeta>{version}</InlineMeta>}
            <MetaBadge>{(server.type ?? 'stdio').toUpperCase()}</MetaBadge>
            {server.installSource === 'builtin' && <MetaBadge>{t('settings.mcp.builtinServers')}</MetaBadge>}
            {server.provider && <MetaBadge className="bg-primary/8 text-primary">{server.provider}</MetaBadge>}
            {server.providerUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-2 shadow-none"
                onClick={handleOpenUrl}
                data-no-dnd>
                <SquareArrowOutUpRight size={13} />
              </Button>
            )}
          </ServerNameWrapper>
        </ServerMain>
        <ToolbarWrapper onClick={(e) => e.stopPropagation()}>
          {isEditing && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-muted-foreground shadow-none hover:text-destructive"
              onClick={handleDelete}>
              <DeleteIcon size={14} className="lucide-custom" />
            </Button>
          )}
          <Switch
            checked={server.isActive}
            key={server.id}
            disabled={isLoading}
            onCheckedChange={handleToggleActive}
            data-no-dnd
          />
        </ToolbarWrapper>
      </CardContainer>
    </ErrorBoundary>
  )
}

const CardContainer = ({
  $isActive,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $isActive: boolean }) => (
  <div
    className={cn(
      'flex min-h-12 w-full items-center justify-between rounded-xl border border-border/60 bg-transparent px-3 py-2 transition-colors hover:bg-accent',
      $isActive ? 'opacity-100' : 'opacity-60',
      className
    )}
    {...props}
  />
)

const ServerMain = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-0 flex-1 items-center gap-3', className)} {...props} />
)

const ServerNameWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap', className)}
    {...props}
  />
)

const ServerNameText = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('min-w-0 truncate font-semibold text-[15px]', className)} {...props} />
)

const ServerLogo = ({ className, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
  <img className={cn('h-5 w-5 rounded object-cover', className)} {...props} />
)

const ToolbarWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('ml-4 flex shrink-0 items-center gap-2', className)} {...props} />
)

const ActiveDot = ({ $active, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $active: boolean }) => (
  <div
    className={cn(
      'size-2 shrink-0 rounded-full',
      $active ? 'bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.16)]' : 'bg-muted-foreground/35',
      className
    )}
    {...props}
  />
)

const InlineMeta = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('shrink-0 text-muted-foreground text-sm', className)} {...props} />
)

const MetaBadge = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center rounded-md bg-muted px-2 py-0.5 font-medium text-[12px] text-muted-foreground leading-none',
      className
    )}
    {...props}
  />
)

export default McpServerCard
