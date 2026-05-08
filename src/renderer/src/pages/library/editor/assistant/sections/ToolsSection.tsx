import { Alert, Button } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { Plug } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AssistantConfigMcpMode, MCP_MODE_OPTIONS } from '../../../constants'
import { AddCatalogPopover, BoundCatalogList, type CatalogItem } from '../../components/CatalogPicker'
import { McpServerAvatar } from '../../components/McpServerAvatar'
import { FieldHeader } from '../../FieldHeader'

interface Props {
  mcpMode: AssistantConfigMcpMode
  mcpServerIds: string[]
  onModeChange: (mode: AssistantConfigMcpMode) => void
  onServerIdsChange: (ids: string[]) => void
}

/**
 * MCP servers + mode selector — writes top-level `mcpServerIds` and
 * `settings.mcpMode`.
 *
 * Manual-mode list uses the button-plus-popover pattern: bound servers render
 * as cards with a Switch that simply removes them from `mcpServerIds` when
 * toggled off (there is no per-assistant "disabled but bound" state — presence
 * in the array IS the enabled state).
 */
const ToolsSection: FC<Props> = ({ mcpMode, mcpServerIds, onModeChange, onServerIdsChange }) => {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const catalog = useMemo<CatalogItem[]>(() => {
    return mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description || server.baseUrl || server.command,
      icon: <McpServerAvatar server={server} size={28} />,
      inactiveBadge: server.isActive ? undefined : t('library.config.tools.inactive_badge'),
      pickable: server.isActive
    }))
  }, [mcpServers, t])

  const enabledIds = useMemo(() => new Set(mcpServerIds), [mcpServerIds])
  const catalogById = useMemo(() => new Map(catalog.map((server) => [server.id, server])), [catalog])
  const boundServers = useMemo(() => {
    return mcpServerIds.map((id) => catalogById.get(id)).filter((server): server is CatalogItem => Boolean(server))
  }, [catalogById, mcpServerIds])

  const remove = (id: string) => onServerIdsChange(mcpServerIds.filter((x) => x !== id))
  const add = (id: string) => {
    onServerIdsChange([...mcpServerIds, id])
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.tools.title')}</h3>
        <p className="text-muted-foreground/60 text-xs">{t('library.config.tools.desc')}</p>
      </div>

      <ModeGroup>
        {MCP_MODE_OPTIONS.map((mode) => (
          <ModeRow
            key={mode.id}
            label={t(mode.labelKey)}
            desc={t(mode.descKey)}
            active={mcpMode === mode.id}
            onClick={() => onModeChange(mode.id)}
          />
        ))}
      </ModeGroup>

      {mcpMode === 'manual' && (
        <div>
          <FieldHeader
            label={t('library.config.tools.added')}
            hint={t('library.config.tools.added_hint')}
            className="mb-2"
          />

          <BoundCatalogList
            items={boundServers}
            loading={isLoading}
            onDisable={remove}
            emptyLabel={t('library.config.tools.empty_title')}
            emptyContent={<EmptyHint />}
            noMatchLabel={t('library.no_match')}
          />

          <div className="mt-2">
            <AddCatalogPopover
              items={catalog}
              enabledIds={enabledIds}
              onAdd={add}
              disabled={isLoading}
              align="start"
              triggerLabel={t('library.config.tools.add_mcp')}
              searchPlaceholder={t('library.config.tools.search')}
              emptyLabel={t('library.config.tools.no_more')}
              triggerPosition="start"
              triggerClassName="border border-border/20 px-2.5 py-1.5 hover:border-border/40"
            />
          </div>
        </div>
      )}

      <Alert type="info" showIcon className="rounded-xs border-blue-500/15 bg-blue-500/5 px-3 py-2.5 shadow-none">
        <div>
          <p className="text-blue-600/70 text-xs dark:text-blue-400/80">{t('library.config.tools.info_main')}</p>
          <p className="mt-0.5 text-blue-600/50 text-xs dark:text-blue-400/60">{t('library.config.tools.info_sub')}</p>
        </div>
      </Alert>
    </div>
  )
}

function ModeGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}

function ModeRow({
  label,
  desc,
  active,
  onClick
}: {
  label: string
  desc: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`flex h-auto min-h-0 items-start justify-start gap-2.5 rounded-xs border px-3 py-2.5 text-left font-normal shadow-none transition-all focus-visible:ring-0 ${
        active
          ? 'border-primary/35 bg-primary/[0.06] text-foreground hover:bg-primary/[0.06] hover:text-foreground'
          : 'border-border/30 bg-accent/15 text-muted-foreground/70 hover:border-border/45 hover:bg-accent/30 hover:text-foreground'
      }`}>
      <span
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
          active ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="mt-0.5 text-muted-foreground/55 text-xs">{desc}</div>
      </div>
    </Button>
  )
}

function EmptyHint() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center rounded-xs border border-border/20 border-dashed p-6">
      <Plug size={20} strokeWidth={1.2} className="mb-2 text-muted-foreground/40" />
      <p className="mb-1 text-muted-foreground/60 text-xs">{t('library.config.tools.empty_title')}</p>
      <p className="text-muted-foreground/50 text-xs">{t('library.config.tools.empty_desc')}</p>
    </div>
  )
}

export default ToolsSection
