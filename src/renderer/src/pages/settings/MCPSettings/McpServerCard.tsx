import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { DeleteIcon } from '@renderer/components/Icons'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { getMcpTypeLabel } from '@renderer/i18n/label'
import { MCPServer } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { Alert, Button, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import { CircleXIcon, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import { FC, useCallback } from 'react'
import { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface McpServerCardProps {
  server: MCPServer
  version?: string | null
  isLoading: boolean
  onToggle: (active: boolean) => void
  onDelete: () => void
  onEdit: () => void
  onOpenUrl: (url: string) => void
}

const McpServerCard: FC<McpServerCardProps> = ({
  server,
  version,
  isLoading,
  onToggle,
  onDelete,
  onEdit,
  onOpenUrl
}) => {
  const { t } = useTranslation()
  const handleOpenUrl = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (server.providerUrl) {
      onOpenUrl(server.providerUrl)
    }
  }

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

      const onClickDetails = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation()
        GeneralPopup.show({ content: <ErrorDetails /> })
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
              <Button
                danger
                type="text"
                icon={
                  <Tooltip title={t('error.boundary.details')}>
                    <CircleXIcon size={16} />
                  </Tooltip>
                }
                size="small"
                onClick={onClickDetails}
              />
              <Button
                danger
                type="text"
                icon={
                  <Tooltip title={t('common.delete')}>
                    <DeleteIcon size={16} />
                  </Tooltip>
                }
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              />
            </Space.Compact>
          }
        />
      )
    },
    [onDelete, t]
  )

  return (
    <ErrorBoundary fallbackComponent={Fallback}>
      <CardContainer $isActive={server.isActive} onClick={onEdit}>
        <ServerHeader>
          <ServerNameWrapper>
            {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
            <ServerNameText ellipsis={{ tooltip: true }}>{server.name}</ServerNameText>
            {server.providerUrl && (
              <Button
                type="text"
                size="small"
                shape="circle"
                icon={<SquareArrowOutUpRight size={14} />}
                onClick={handleOpenUrl}
                data-no-dnd
              />
            )}
          </ServerNameWrapper>
          <ToolbarWrapper onClick={(e) => e.stopPropagation()}>
            <Switch
              value={server.isActive}
              key={server.id}
              loading={isLoading}
              onChange={onToggle}
              size="small"
              data-no-dnd
            />
            <Button
              type="text"
              shape="circle"
              icon={<DeleteIcon size={14} className="lucide-custom" />}
              danger
              onClick={onDelete}
              data-no-dnd
            />
            <Button type="text" shape="circle" icon={<Settings2 size={14} />} onClick={onEdit} data-no-dnd />
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
  border-radius: var(--list-item-border-radius);
  padding: 10px 10px 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  margin-bottom: 5px;
  height: 125px;
  opacity: ${(props) => (props.$isActive ? 1 : 0.6)};

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
