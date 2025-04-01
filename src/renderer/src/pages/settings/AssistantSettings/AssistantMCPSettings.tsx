import { InfoCircleOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Empty, Switch, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface MCPServer {
  id: string
  name: string
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  isActive: boolean
}

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantMCPSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()

  const { mcpServers: allMcpServers } = useMCPServers()
  const onUpdate = (ids: string[]) => {
    const mcpServers = ids
      .map((id) => allMcpServers.find((server) => server.id === id))
      .filter((server): server is MCPServer => server !== undefined && server.isActive)
    const _assistant = { ...assistant, mcpServers }
    updateAssistant(_assistant)
  }

  const handleServerToggle = (serverId: string) => {
    const currentServerIds = assistant.mcpServers?.map((server) => server.id) || []

    if (currentServerIds.includes(serverId)) {
      // Remove server if it's already enabled
      onUpdate(currentServerIds.filter((id) => id !== serverId))
    } else {
      // Add server if it's not enabled
      onUpdate([...currentServerIds, serverId])
    }
  }

  const enabledCount = assistant.mcpServers?.length || 0

  return (
    <Container>
      <HeaderContainer>
        <Box style={{ fontWeight: 'bold', fontSize: '16px' }}>
          {t('assistants.settings.mcp.title')}
          <Tooltip title={t('assistants.settings.mcp.description', 'Select MCP servers to use with this assistant')}>
            <InfoIcon />
          </Tooltip>
        </Box>
        {allMcpServers.length > 0 && (
          <EnabledCount>
            {enabledCount} / {allMcpServers.length} {t('settings.mcp.active')}
          </EnabledCount>
        )}
      </HeaderContainer>

      {allMcpServers.length > 0 ? (
        <ServerList>
          {allMcpServers.map((server) => {
            const isEnabled = assistant.mcpServers?.some((s) => s.id === server.id) || false

            return (
              <ServerItem key={server.id} isEnabled={isEnabled}>
                <ServerInfo>
                  <ServerName>{server.name}</ServerName>
                  {server.description && <ServerDescription>{server.description}</ServerDescription>}
                  {server.baseUrl && <ServerUrl>{server.baseUrl}</ServerUrl>}
                </ServerInfo>
                <Tooltip
                  title={
                    !server.isActive
                      ? t('assistants.settings.mcp.enableFirst', 'Enable this server in MCP settings first')
                      : undefined
                  }>
                  <Switch
                    checked={isEnabled}
                    disabled={!server.isActive}
                    onChange={() => handleServerToggle(server.id)}
                    size="small"
                  />
                </Tooltip>
              </ServerItem>
            )
          })}
        </ServerList>
      ) : (
        <EmptyContainer>
          <Empty
            description={t('assistants.settings.mcp.noAvaliable', 'No MCP servers available')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </EmptyContainer>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  background-color: ${(props) => props.theme.colors?.background || '#f9f9f9'};
  border-radius: 8px;
`

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const InfoIcon = styled(InfoCircleOutlined)`
  margin-left: 6px;
  font-size: 14px;
  color: ${(props) => props.theme.colors?.textSecondary || '#8c8c8c'};
  cursor: help;
`

const EnabledCount = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.colors?.textSecondary || '#8c8c8c'};
`

const EmptyContainer = styled.div`
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 40px 0;
`

const ServerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 4px;
`

const ServerItem = styled.div<{ isEnabled: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: ${(props) => props.theme.colors?.cardBackground || '#fff'};
  border: 1px solid ${(props) => props.theme.colors?.border || '#e6e6e6'};
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }

  opacity: ${(props) => (props.isEnabled ? 1 : 0.7)};
`

const ServerInfo = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
`

const ServerName = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`

const ServerDescription = styled.div`
  font-size: 0.85rem;
  color: ${(props) => props.theme.colors?.textSecondary || '#8c8c8c'};
  margin-bottom: 3px;
`

const ServerUrl = styled.div`
  font-size: 0.8rem;
  color: ${(props) => props.theme.colors?.textTertiary || '#bfbfbf'};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default AssistantMCPSettings
