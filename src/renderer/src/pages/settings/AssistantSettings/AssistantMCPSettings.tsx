import { InfoCircleOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { Assistant, AssistantSettings, McpMode } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import { Empty, Radio, Switch, Tooltip } from 'antd'
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

  const currentMode = getEffectiveMcpMode(assistant)

  const handleModeChange = (mode: McpMode) => {
    updateAssistant({ ...assistant, mcpMode: mode })
  }

  const onUpdate = (ids: string[]) => {
    const mcpServers = ids
      .map((id) => allMcpServers.find((server) => server.id === id))
      .filter((server): server is MCPServer => server !== undefined && server.isActive)

    updateAssistant({ ...assistant, mcpServers, mcpMode: 'manual' })
  }

  const handleServerToggle = (serverId: string) => {
    const currentServerIds = assistant.mcpServers?.map((server) => server.id) || []

    if (currentServerIds.includes(serverId)) {
      onUpdate(currentServerIds.filter((id) => id !== serverId))
    } else {
      onUpdate([...currentServerIds, serverId])
    }
  }

  const enabledCount = assistant.mcpServers?.length || 0

  return (
    <Container>
      <HeaderContainer>
        <Box style={{ fontWeight: 'bold', fontSize: '14px' }}>
          {t('assistants.settings.mcp.title')}
          <Tooltip title={t('assistants.settings.mcp.description', 'Select MCP servers to use with this assistant')}>
            <InfoIcon />
          </Tooltip>
        </Box>
      </HeaderContainer>

      <ModeSelector>
        <Radio.Group value={currentMode} onChange={(e) => handleModeChange(e.target.value)}>
          <Radio.Button value="disabled">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.disabled.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.disabled.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
          <Radio.Button value="auto">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.auto.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.auto.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
          <Radio.Button value="manual">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.manual.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.manual.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
        </Radio.Group>
      </ModeSelector>

      {currentMode === 'manual' && (
        <>
          {allMcpServers.length > 0 && (
            <EnabledCount>
              {enabledCount} / {allMcpServers.length} {t('settings.mcp.active')}
            </EnabledCount>
          )}

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
                description={t('assistants.settings.mcp.noServersAvailable', 'No MCP servers available')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </EmptyContainer>
          )}
        </>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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
  color: var(--color-text-2);
  cursor: help;
`

const ModeSelector = styled.div`
  margin-bottom: 16px;

  .ant-radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ant-radio-button-wrapper {
    height: auto;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);

    &:not(:first-child)::before {
      display: none;
    }

    &:first-child {
      border-radius: 8px;
    }

    &:last-child {
      border-radius: 8px;
    }
  }
`

const ModeOption = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ModeLabel = styled.span`
  font-weight: 600;
`

const ModeDescription = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`

const EnabledCount = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 8px;
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
`

const ServerItem = styled.div<{ isEnabled: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  transition: all 0.2s ease;
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
  color: var(--color-text-2);
  margin-bottom: 3px;
`

const ServerUrl = styled.div`
  font-size: 0.8rem;
  color: var(--color-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default AssistantMCPSettings
