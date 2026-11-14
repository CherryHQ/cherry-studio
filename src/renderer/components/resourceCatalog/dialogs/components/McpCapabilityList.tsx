import { FileJson, Plus, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddMcpServerModal from '@renderer/components/mcp/AddMcpServerModal'
import QuickCreateMcpServerDialog from '@renderer/components/mcp/QuickCreateMcpServerDialog'
import { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { getBuiltInMcpServerDescriptionLabelKey } from '@renderer/i18n/label'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { toFeaturedMcpId } from '@renderer/utils/resourceCatalog'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServerPreset } from '@shared/data/presets/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { CapabilityIconTile, type CapabilityItem, CapabilityList } from './CapabilityList'

const serverIcon = (
  <CapabilityIconTile>
    <Wrench size={13} strokeWidth={1.6} />
  </CapabilityIconTile>
)

/**
 * MCP servers bound to an Assistant or Agent. Featured marketplace servers that need no
 * configuration are listed too; switching one on installs it and binds the new server.
 */
export function McpCapabilityList({
  selectedIds,
  onSelectedIdsChange,
  emptyLabel,
  portalContainer,
  disabled = false
}: {
  selectedIds: readonly string[]
  onSelectedIdsChange: (ids: string[]) => void
  emptyLabel: ReactNode
  portalContainer: HTMLElement | null
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const catalog = useBuiltinMcpCatalog()
  const { addMcpServer } = useMcpServers()
  const [manualOpen, setManualOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // Installs finish after later toggles; bind against the latest selection, not the one at click time.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const servers = useMemo(
    () => catalog.mcpServers.filter((server) => !isBrowserMcpServer(server)),
    [catalog.mcpServers]
  )
  const statuses = useMcpRuntimeStatusMap(servers)

  const install = async (preset: McpServerPreset) => {
    try {
      const server = await catalog.installFeatured(preset)
      onSelectedIdsChange(Array.from(new Set([...selectedIdsRef.current, server.id])))
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('settings.mcp.addError')))
    }
  }

  const items: CapabilityItem[] = [
    ...servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      icon: serverIcon,
      pickable: server.isActive,
      badge: !server.isActive
        ? t('library.config.tools.inactive_badge')
        : statuses[server.id]?.state === 'error'
          ? t('settings.mcp.runtimeStatus.unavailable')
          : undefined
    })),
    ...catalog.featured.map((preset) => ({
      id: toFeaturedMcpId(preset.name),
      name: preset.name,
      description: t(getBuiltInMcpServerDescriptionLabelKey(preset.name)),
      icon: serverIcon,
      badge: t('library.config.tools.featured_badge'),
      pending: catalog.adding.has(preset.name),
      onToggle: (enabled: boolean) => {
        if (enabled) void install(preset)
      }
    }))
  ]

  const createServers = async (dtos: CreateMcpServerDto[]): Promise<McpServer[]> => {
    const created: McpServer[] = []
    for (const dto of dtos) created.push(await addMcpServer(dto))
    setImportOpen(false)
    toast.success(t('settings.mcp.addSuccess'))
    return created
  }

  return (
    <CapabilityList
      items={items}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
      searchPlaceholder={t('library.config.tools.search_mcp')}
      addLabel={t('library.config.tools.add_mcp')}
      addActions={[
        {
          id: 'manual',
          label: t('library.config.tools.add_manually'),
          icon: <Plus />,
          onSelect: () => setManualOpen(true)
        },
        {
          id: 'json',
          label: t('settings.mcp.addServer.importFrom.json'),
          icon: <FileJson />,
          onSelect: () => setImportOpen(true)
        }
      ]}
      emptyLabel={emptyLabel}
      portalContainer={portalContainer}
      loading={catalog.isLoading}
      disabled={disabled}>
      <QuickCreateMcpServerDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        existingServers={catalog.mcpServers}
        onCreate={async (dto) => {
          await addMcpServer(dto)
          toast.success(t('settings.mcp.addSuccess'))
        }}
      />
      <AddMcpServerModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={createServers}
        existingServers={catalog.mcpServers}
        initialImportMethod="json"
      />
    </CapabilityList>
  )
}
