import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import { Divider } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'

import { type LocalRuntimeState, summarizeHealth } from './healthSummary'

const LOCAL_RUNTIME_STATE_KEYS: Record<LocalRuntimeState, string> = {
  ok: 'settings.about.health.localRuntime.ok',
  down: 'settings.about.health.localRuntime.down',
  unknown: 'settings.about.health.localRuntime.unknown'
}

function formatWhen(at: number): string {
  return dayjs(at).format('YYYY-MM-DD HH:mm')
}

/**
 * "Is my setup actually working right now" in one place: connected providers, enabled keys,
 * model health, local runtimes (LM Studio / Ollama…), and MCP servers. Every number here is read
 * from state the app already records — nothing on this page sends a request to check.
 */
export function HealthOverview() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders({ enabled: true })
  const { models } = useModels({ enabled: true })
  const [modelHealth] = usePreference('chat.retry.model_health')
  const { mcpServers } = useMcpServers()
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)

  const summary = summarizeHealth({ providers, models, modelHealth, mcpServers, mcpStatuses })

  return (
    <SettingGroup theme={theme} id="setting-about-health" className="scroll-mt-6">
      <SettingTitle>{t('settings.about.health.title')}</SettingTitle>
      <Divider className="my-3" />

      <SettingRow>
        <SettingRowTitle>{t('settings.about.health.providers.label')}</SettingRowTitle>
        <span className="text-muted-foreground text-sm">
          {t('settings.about.health.providers.value', {
            connected: summary.providers.connectedCount,
            enabled: summary.providers.enabledCount
          })}
        </span>
      </SettingRow>
      <Divider className="my-3" />

      <SettingRow>
        <SettingRowTitle>{t('settings.about.health.keys.label')}</SettingRowTitle>
        <span className="text-muted-foreground text-sm">
          {t('settings.about.health.keys.value', { enabled: summary.keys.enabledCount })}
        </span>
      </SettingRow>
      <div className="mt-1 text-muted-foreground text-xs">{t('settings.about.health.keys.hint')}</div>
      <Divider className="my-3" />

      <SettingRow>
        <SettingRowTitle>{t('settings.about.health.models.label')}</SettingRowTitle>
        <span className="text-muted-foreground text-sm">
          {t('settings.about.health.models.value', {
            healthy: summary.models.healthyCount,
            unhealthy: summary.models.unhealthyCount,
            unchecked: summary.models.uncheckedCount
          })}
        </span>
      </SettingRow>
      <Divider className="my-3" />

      <SettingRowTitle className="mb-1.5">{t('settings.about.health.localRuntime.label')}</SettingRowTitle>
      {summary.localRuntimes.length === 0 ? (
        <div className="text-muted-foreground text-sm">{t('settings.about.health.localRuntime.empty')}</div>
      ) : (
        summary.localRuntimes.map((runtime) => (
          <div key={runtime.providerId} className="text-muted-foreground text-sm">
            {t(LOCAL_RUNTIME_STATE_KEYS[runtime.state], {
              name: runtime.name,
              ...(runtime.checkedAt !== undefined && { when: formatWhen(runtime.checkedAt) })
            })}
          </div>
        ))
      )}
      <Divider className="my-3" />

      <SettingRow>
        <SettingRowTitle>{t('settings.about.health.mcp.label')}</SettingRowTitle>
        <span className="text-muted-foreground text-sm">
          {t('settings.about.health.mcp.value', {
            active: summary.mcp.activeCount,
            installed: summary.mcp.installedCount
          })}
        </span>
      </SettingRow>
      <SettingRow className="mt-1.5">
        <SettingRowTitle>{t('settings.about.health.mcp.lastError.label')}</SettingRowTitle>
        <span className="text-muted-foreground text-sm">
          {summary.mcp.lastError
            ? t('settings.about.health.mcp.lastError.value', {
                name: summary.mcp.lastError.serverName,
                message: summary.mcp.lastError.message,
                when: formatWhen(summary.mcp.lastError.at)
              })
            : t('settings.about.health.mcp.lastError.empty')}
        </span>
      </SettingRow>
    </SettingGroup>
  )
}
