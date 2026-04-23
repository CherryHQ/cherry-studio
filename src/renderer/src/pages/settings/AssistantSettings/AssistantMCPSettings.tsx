import { Box, InfoTooltip, Switch, Tooltip } from '@cherrystudio/ui'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { Assistant, McpMode } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { Empty, Radio } from 'antd'
import type React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
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
          <InfoTooltip
            content={t('assistants.settings.mcp.description', 'Select MCP servers to use with this assistant')}
            iconProps={{ className: 'ml-1.5 text-xs text-color-text-2 cursor-help' }}
          />
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
                      content={
                        !server.isActive
                          ? t('assistants.settings.mcp.enableFirst', 'Enable this server in MCP settings first')
                          : undefined
                      }>
                      <Switch
                        checked={isEnabled}
                        disabled={!server.isActive}
                        onCheckedChange={() => handleServerToggle(server.id)}
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

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-0 flex-1 flex-col', className)} {...props} />
)

const HeaderContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-4 flex items-center justify-between', className)} {...props} />
)

const ModeSelector = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'mb-4 [&_.ant-radio-button-wrapper:not(:first-child)::before]:hidden [&_.ant-radio-button-wrapper]:h-auto [&_.ant-radio-button-wrapper]:rounded-lg [&_.ant-radio-button-wrapper]:border [&_.ant-radio-button-wrapper]:border-border [&_.ant-radio-button-wrapper]:px-4 [&_.ant-radio-button-wrapper]:py-3 [&_.ant-radio-group]:flex [&_.ant-radio-group]:flex-col [&_.ant-radio-group]:gap-2',
      className
    )}
    {...props}
  />
)

const ModeOption = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-0.5', className)} {...props} />
)

const ModeLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('font-semibold', className)} {...props} />
)

const ModeDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('text-foreground-secondary text-xs', className)} {...props} />
)

const EnabledCount = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mb-2 text-foreground-secondary text-xs', className)} {...props} />
)

const EmptyContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-1 items-center justify-center py-10', className)} {...props} />
)

const ServerList = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-2 overflow-y-auto', className)} {...props} />
)

const ServerItem = ({
  className,
  isEnabled,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { isEnabled: boolean }) => (
  <div
    className={cn(
      'flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-all',
      isEnabled ? 'opacity-100' : 'opacity-70',
      className
    )}
    {...props}
  />
)

const ServerInfo = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-1 flex-col overflow-hidden', className)} {...props} />
)

const ServerName = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-1 font-semibold', className)} {...props} />
)

const ServerDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-0.75 text-[0.85rem] text-foreground-secondary', className)} {...props} />
)

const ServerUrl = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('truncate text-[0.8rem] text-foreground-muted', className)} {...props} />
)

export default AssistantMCPSettings
