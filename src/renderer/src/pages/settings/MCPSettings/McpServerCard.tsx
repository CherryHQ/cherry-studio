import { DeleteIcon } from '@renderer/components/Icons'
import { getMcpTypeLabel } from '@renderer/i18n/label'
import { MCPServer } from '@renderer/types'
import { Badge, Button, Switch, Tag } from 'antd'
import { Settings2, SquareArrowOutUpRight } from 'lucide-react'
import { FC } from 'react'
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
  const handleOpenUrl = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (server.providerUrl) {
      onOpenUrl(server.providerUrl)
    }
  }

  return (
    <CardContainer $isActive={server.isActive}>
      <ServerHeader>
        <ServerName>
          {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
          <ServerNameText>{server.name}</ServerNameText>
          {version && <VersionBadge count={version} color="blue" />}
          {server.providerUrl && (
            <Button
              type="text"
              size="small"
              shape="circle"
              icon={<SquareArrowOutUpRight size={14} />}
              className="nodrag"
              onClick={handleOpenUrl}
            />
          )}
        </ServerName>
        <ToolbarWrapper onClick={(e) => e.stopPropagation()}>
          <Switch value={server.isActive} key={server.id} loading={isLoading} onChange={onToggle} size="small" />
          <Button
            type="text"
            shape="circle"
            icon={<DeleteIcon size={16} className="lucide-custom" />}
            className="nodrag"
            danger
            onClick={onDelete}
          />
          <Button type="text" shape="circle" icon={<Settings2 size={16} />} className="nodrag" onClick={onEdit} />
        </ToolbarWrapper>
      </ServerHeader>
      <ServerDescription>{server.description}</ServerDescription>
      <ServerFooter>
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
  )
}

// Styled components
const CardContainer = styled.div<{ $isActive: boolean }>`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  padding: 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  margin-bottom: 5px;
  height: 125px;
  cursor: pointer;
  opacity: ${(props) => (props.$isActive ? 1 : 0.6)};

  &:hover {
    border-color: var(--color-primary);
    opacity: 1;
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
`

const ServerName = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
`

const ServerNameText = styled.span`
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
  gap: 4px;

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

const ServerFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-start;
  margin-top: 10px;
`

const ServerTag = styled(Tag)`
  border-radius: 20px;
  margin: 0;
`

const VersionBadge = styled(Badge)`
  .ant-badge-count {
    background-color: var(--color-primary);
    color: white;
    font-size: 10px;
    font-weight: 500;
    padding: 0 5px;
    height: 16px;
    line-height: 16px;
    border-radius: 8px;
    min-width: 16px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
`

export default McpServerCard
