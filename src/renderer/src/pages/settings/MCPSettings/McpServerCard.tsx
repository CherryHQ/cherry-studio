import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { DeleteIcon } from '@renderer/components/Icons'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServerMutations } from '@renderer/hooks/useMCPServers'
import { useMCPServerTrust } from '@renderer/hooks/useMCPServerTrust'
import { getMcpTypeLabel } from '@renderer/i18n/label'
import { formatMcpError } from '@renderer/utils/error'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { Alert, Space, Tag, Typography } from 'antd'
import { CircleXIcon, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('McpServerCard')

interface McpServerCardProps {
  server: MCPServer
  onEdit: () => void
}

const McpServerCard: FC<McpServerCardProps> = ({ server, onEdit }) => {
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
          style={{ height: 125, alignItems: 'flex-start', padding: 12 }}
          description={
            <Typography.Paragraph style={{ color: 'var(--color-error-base)' }} ellipsis={{ rows: 3 }}>
              {errorDetails}
            </Typography.Paragraph>
          }
          onClick={onClickDetails}
          action={
            <Space.Compact>
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
            </Space.Compact>
          }
        />
      )
    },
    [handleDelete, t]
  )

  return (
    <ErrorBoundary fallbackComponent={Fallback}>
      <CardContainer $isActive={server.isActive} onClick={onEdit}>
        <ServerHeader>
          <ServerNameWrapper>
            {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
            <ServerNameText ellipsis={{ tooltip: true }}>{server.name}</ServerNameText>
            {server.providerUrl && (
              <Button variant="ghost" size="sm" className="rounded-full" onClick={handleOpenUrl} data-no-dnd>
                <SquareArrowOutUpRight size={14} />
              </Button>
            )}
          </ServerNameWrapper>
          <ToolbarWrapper onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={server.isActive}
              key={server.id}
              disabled={isLoading}
              onCheckedChange={handleToggleActive}
              data-no-dnd
            />
            <Button size="sm" variant="destructive" className="rounded-full" onClick={handleDelete}>
              <DeleteIcon size={14} className="lucide-custom" />
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full" onClick={onEdit} data-no-dnd>
              <Settings2 size={14} />
            </Button>
          </ToolbarWrapper>
        </ServerHeader>
        <ServerDescription>{server.description}</ServerDescription>
        <ServerFooter>
          {version && (
            <VersionBadge color="#108ee9">
              <VersionText ellipsis={{ tooltip: true }}>{version}</VersionText>
            </VersionBadge>
          )}
          <ServerTag color="processing">{getMcpTypeLabel(server.type ?? 'stdio')}</ServerTag>
          {server.provider && <ServerTag color="success">{server.provider}</ServerTag>}
          {server.tags
            ?.filter((tag): tag is string => typeof tag === 'string') // Avoid existing non-string tags crash the UI
            .map((tag) => (
              <ServerTag key={tag} color="default">
                {tag}
              </ServerTag>
            ))}
        </ServerFooter>
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
      'mb-[5px] flex h-[125px] w-full flex-col rounded-[var(--cs-radius-2xs)] border-[0.5px] border-border bg-background py-2.5 pr-2.5 pl-4 transition-all hover:border-primary hover:opacity-100 hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]',
      $isActive ? 'opacity-100' : 'opacity-60',
      className
    )}
    {...props}
  />
)

const ServerHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-[5px] flex items-center', className)} {...props} />
)

const ServerNameWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-1 items-center gap-1 overflow-hidden whitespace-nowrap', className)} {...props} />
)

const ServerNameText = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Typography.Text>) => (
  <Typography.Text className={cn('font-medium text-[15px]', className)} {...props} />
)

const ServerLogo = ({ className, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
  <img className={cn('mr-2 h-6 w-6 rounded object-cover', className)} {...props} />
)

const ToolbarWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('ml-2 flex items-center [&>*:first-child]:mr-1', className)} {...props} />
)

const ServerDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('line-clamp-3 h-[50px] w-full break-words text-foreground-secondary text-xs', className)}
    {...props}
  />
)

const ServerFooter = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => (
  <Scrollbar
    className={cn('mt-2.5 flex min-h-[22px] flex-row items-center justify-start gap-1 overflow-x-auto', className)}
    style={{ scrollbarWidth: 'none' }}
    {...props}
  />
)

const ServerTag = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Tag>) => (
  <Tag className={cn('m-0 rounded-[20px]', className)} {...props} />
)

const VersionBadge = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Tag>) => (
  <ServerTag className={cn('max-w-24 font-medium', className)} {...props} />
)

const VersionText = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Typography.Text>) => (
  <Typography.Text className={cn('text-inherit text-white', className)} {...props} />
)

export default McpServerCard
