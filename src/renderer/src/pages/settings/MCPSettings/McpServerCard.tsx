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
import type { MCPServer } from '@shared/data/types/mcpServer'
import { Alert, Space, Tag, Typography } from 'antd'
import { CircleXIcon, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
              color: 'var(--color-status-error)'
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
            <Typography.Paragraph style={{ color: 'var(--color-status-error)' }} ellipsis={{ rows: 3 }}>
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

// Styled components
const CardContainer = styled.div<{ $isActive: boolean }>`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--cs-radius-2xs);
  padding: 10px 10px 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  margin-bottom: 5px;
  height: 125px;
  opacity: ${(props) => (props.$isActive ? 1 : 0.6)};
  width: 100%;

  &:hover {
    opacity: 1;
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
`

const ServerNameWrapper = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 4px;
`

const ServerNameText = styled(Typography.Text)`
  font-size: 15px;
  font-weight: 500;
`

const ServerLogo = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
  margin-right: 8px;
`

const ToolbarWrapper = styled.div`
  display: flex;
  align-items: center;
  margin-left: 8px;

  > :first-child {
    margin-right: 4px;
  }
`

const ServerDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  width: 100%;
  word-break: break-word;
  height: 50px;
`

const ServerFooter = styled(Scrollbar)`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-direction: row;
  overflow-x: auto;
  min-height: 22px;
  gap: 4px;
  margin-top: 10px;

  &::-webkit-scrollbar {
    display: none;
  }
`

const ServerTag = styled(Tag)`
  border-radius: 20px;
  margin: 0;
`

const VersionBadge = styled(ServerTag)`
  font-weight: 500;
  max-width: 6rem !important;
`

const VersionText = styled(Typography.Text)`
  font-size: inherit;
  color: white;
`

export default McpServerCard
