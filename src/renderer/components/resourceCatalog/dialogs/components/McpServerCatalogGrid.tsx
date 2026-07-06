import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { openSettingsWindow } from '@renderer/services/SettingsWindowService'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { TFunction } from 'i18next'
import { Settings } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from './CatalogPicker'

const logger = loggerService.withContext('McpServerCatalogGrid')
const MCP_SERVERS_SETTINGS_PATH = '/settings/mcp/servers'

function getStatusBadge(t: TFunction, state: McpRuntimeStatus['state']) {
  switch (state) {
    case 'connected':
      return t('settings.mcp.runtimeStatus.connected', 'Connected')
    case 'connecting':
      return t('settings.mcp.runtimeStatus.connecting', 'Connecting')
    case 'error':
      return t('settings.mcp.runtimeStatus.unavailable', 'Unavailable')
    default:
      return undefined
  }
}

function getStatusBadgeClassName(state: McpRuntimeStatus['state']) {
  switch (state) {
    case 'connected':
      return 'bg-success/10 text-success'
    case 'connecting':
      return 'bg-warning/10 text-warning'
    case 'error':
      return 'bg-destructive/10 text-destructive'
    default:
      return undefined
  }
}

function getServerState(server: McpServer, status: McpRuntimeStatus | undefined): McpRuntimeStatus['state'] {
  return server.isActive ? (status?.state ?? 'connecting') : 'disabled'
}

export function McpServerCatalogGrid({
  enabledIds,
  emptyLabel,
  onToggle,
  portalContainer,
  title
}: {
  enabledIds: ReadonlySet<string>
  emptyLabel: string
  onToggle: (id: string, enabled: boolean) => void
  portalContainer: HTMLElement | null
  title?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo<McpServer[]>(() => data?.items ?? [], [data])
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const settingsLabel = title ? `${title} ${t('settings.title')}` : t('settings.mcp.title')
  const catalog = useMemo<CatalogItem[]>(
    () =>
      mcpServers.map((server) => {
        const state = getServerState(server, mcpStatuses[server.id])

        return {
          id: server.id,
          name: server.name,
          inactiveBadge: server.isActive ? undefined : t('library.config.tools.inactive_badge'),
          statusBadge: getStatusBadge(t, state),
          statusBadgeClassName: getStatusBadgeClassName(state),
          pickable: server.isActive
        }
      }),
    [mcpServers, mcpStatuses, t]
  )

  const handleOpenMcpSettings = () => {
    void openSettingsWindow(MCP_SERVERS_SETTINGS_PATH).catch((error) => {
      logger.error('Failed to open MCP server settings', error as Error)
    })
  }

  return (
    <div>
      {title ? (
        <div className="flex items-center gap-1.5">
          <div className="font-medium text-foreground text-sm leading-none">{title}</div>
          <Tooltip content={settingsLabel} portalContainer={portalContainer ?? undefined}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={settingsLabel}
              title={settingsLabel}
              onClick={handleOpenMcpSettings}
              className="flex size-6 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/80 shadow-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40">
              <Settings size={12} strokeWidth={1.7} />
            </Button>
          </Tooltip>
        </div>
      ) : null}
      <div className={title ? 'mt-2' : undefined}>
        <CatalogToggleGrid
          items={catalog}
          enabledIds={enabledIds}
          loading={isLoading}
          onToggle={onToggle}
          emptyLabel={emptyLabel}
          portalContainer={portalContainer}
        />
      </div>
    </div>
  )
}
