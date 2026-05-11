import { Box, InfoTooltip, Switch, Tooltip } from '@cherrystudio/ui'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { Assistant, McpMode } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { Empty, Radio } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  updateAssistant: (patch: UpdateAssistantDto) => void
}

const AssistantMCPSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const { mcpServers: allMcpServers } = useMCPServers()

  const currentMode = getEffectiveMcpMode(assistant)
  const enabledServerIds = assistant.mcpServerIds ?? []

  const handleModeChange = (mode: McpMode) => {
    updateAssistant({ settings: { ...assistant.settings, mcpMode: mode } })
  }

  const onUpdate = (ids: string[]) => {
    const activeIds = ids.filter((id) => allMcpServers.find((server) => server.id === id && server.isActive))
    updateAssistant({
      mcpServerIds: activeIds,
      settings: { ...assistant.settings, mcpMode: 'manual' }
    })
  }

  const handleServerToggle = (serverId: string) => {
    if (enabledServerIds.includes(serverId)) {
      onUpdate(enabledServerIds.filter((id) => id !== serverId))
    } else {
      onUpdate([...enabledServerIds, serverId])
    }
  }

  const enabledCount = enabledServerIds.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <Box style={{ fontWeight: 'bold', fontSize: '14px' }}>
          {t('assistants.settings.mcp.title')}
          <InfoTooltip
            content={t('assistants.settings.mcp.description', 'Select MCP servers to use with this assistant')}
            iconProps={{ className: 'ml-1.5 text-xs text-color-text-2 cursor-help' }}
          />
        </Box>
      </div>

      <div className="mb-4 [&_.ant-radio-button-wrapper:first-child]:rounded-lg [&_.ant-radio-button-wrapper:last-child]:rounded-lg [&_.ant-radio-button-wrapper:not(:first-child)::before]:hidden [&_.ant-radio-button-wrapper]:h-auto [&_.ant-radio-button-wrapper]:rounded-lg [&_.ant-radio-button-wrapper]:border [&_.ant-radio-button-wrapper]:border-(--color-border) [&_.ant-radio-button-wrapper]:px-4 [&_.ant-radio-button-wrapper]:py-3 [&_.ant-radio-group]:flex [&_.ant-radio-group]:flex-col [&_.ant-radio-group]:gap-2">
        <Radio.Group value={currentMode} onChange={(e) => handleModeChange(e.target.value)}>
          <Radio.Button value="disabled">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{t('assistants.settings.mcp.mode.disabled.label')}</span>
              <span className="text-(--color-text-2) text-xs">
                {t('assistants.settings.mcp.mode.disabled.description')}
              </span>
            </div>
          </Radio.Button>
          <Radio.Button value="auto">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{t('assistants.settings.mcp.mode.auto.label')}</span>
              <span className="text-(--color-text-2) text-xs">
                {t('assistants.settings.mcp.mode.auto.description')}
              </span>
            </div>
          </Radio.Button>
          <Radio.Button value="manual">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{t('assistants.settings.mcp.mode.manual.label')}</span>
              <span className="text-(--color-text-2) text-xs">
                {t('assistants.settings.mcp.mode.manual.description')}
              </span>
            </div>
          </Radio.Button>
        </Radio.Group>
      </div>

      {currentMode === 'manual' && (
        <>
          {allMcpServers.length > 0 && (
            <span className="mb-2 text-(--color-text-2) text-xs">
              {enabledCount} / {allMcpServers.length} {t('settings.mcp.active')}
            </span>
          )}

          {allMcpServers.length > 0 ? (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {allMcpServers.map((server) => {
                const isEnabled = enabledServerIds.includes(server.id)

                return (
                  <div
                    key={server.id}
                    className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-background-mute) px-4 py-3 transition-all duration-200"
                    style={{ opacity: isEnabled ? 1 : 0.7 }}>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="mb-1 font-semibold">{server.name}</div>
                      {server.description && (
                        <div className="mb-[3px] text-(--color-text-2) text-[0.85rem]">{server.description}</div>
                      )}
                      {server.baseUrl && (
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-(--color-text-3) text-[0.8rem]">
                          {server.baseUrl}
                        </div>
                      )}
                    </div>
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
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10">
              <Empty
                description={t('assistants.settings.mcp.noServersAvailable', 'No MCP servers available')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AssistantMCPSettings
