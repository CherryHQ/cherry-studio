import {
  Button,
  Input,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Switch
} from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { AlertCircle, Plug, Plus, Search, Wrench } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AssistantConfigMcpMode, MCP_MODE_OPTIONS } from '../../../constants'
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

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { boundServers, availableForPicker } = useMemo(() => {
    const byId = new Map(mcpServers.map((s) => [s.id, s]))
    const bound = mcpServerIds.map((id) => byId.get(id)).filter((s): s is MCPServer => Boolean(s))
    const keyword = search.trim().toLowerCase()
    const available = mcpServers.filter(
      (s) => s.isActive && !mcpServerIds.includes(s.id) && (!keyword || s.name.toLowerCase().includes(keyword))
    )
    return { boundServers: bound, availableForPicker: available }
  }, [mcpServers, mcpServerIds, search])

  const remove = (id: string) => onServerIdsChange(mcpServerIds.filter((x) => x !== id))
  const add = (id: string) => {
    onServerIdsChange([...mcpServerIds, id])
    setPickerOpen(false)
    setSearch('')
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

          {isLoading ? (
            <p className="px-3 py-2 text-muted-foreground/50 text-xs">{t('common.loading')}</p>
          ) : boundServers.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="space-y-1.5">
              {boundServers.map((s) => (
                <ServerCard key={s.id} server={s} onToggle={() => remove(s.id)} />
              ))}
            </div>
          )}

          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                disabled={isLoading}
                className="mt-2 flex h-auto min-h-0 items-center gap-1 rounded-2xs border border-border/20 px-2.5 py-1.5 font-normal text-muted-foreground/60 text-xs shadow-none transition-colors hover:border-border/40 hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:opacity-50">
                <Plus size={10} /> {t('library.config.tools.add_mcp')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-64 rounded-xs p-2">
              <div className="relative mb-2">
                <Search
                  size={10}
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-muted-foreground/50"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('library.config.tools.search')}
                  className="h-auto rounded-2xs border border-border/20 bg-accent/15 py-1.5 pr-2 pl-6 text-xs shadow-none transition-all focus-visible:border-border/40 focus-visible:ring-0"
                />
              </div>
              {availableForPicker.length === 0 ? (
                <p className="px-2 py-3 text-center text-muted-foreground/50 text-xs">
                  {t('library.config.tools.no_more')}
                </p>
              ) : (
                <Scrollbar className="max-h-60">
                  <MenuList>
                    {availableForPicker.map((s) => (
                      <MenuItem
                        key={s.id}
                        size="sm"
                        variant="ghost"
                        className="rounded-2xs"
                        icon={<ServerAvatar server={s} size={16} />}
                        label={s.name}
                        description={s.description || s.baseUrl || s.command}
                        descriptionLines={1}
                        onClick={() => add(s.id)}
                      />
                    ))}
                  </MenuList>
                </Scrollbar>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xs border border-blue-500/15 bg-blue-500/5 px-3 py-2.5">
        <AlertCircle size={12} className="mt-px shrink-0 text-blue-500/60" />
        <div>
          <p className="text-blue-600/70 text-xs dark:text-blue-400/80">{t('library.config.tools.info_main')}</p>
          <p className="mt-0.5 text-blue-600/50 text-xs dark:text-blue-400/60">{t('library.config.tools.info_sub')}</p>
        </div>
      </div>
    </div>
  )
}

function ServerCard({ server, onToggle }: { server: MCPServer; onToggle: () => void }) {
  const { t } = useTranslation()
  const inactive = !server.isActive
  return (
    <div className="flex items-center gap-3 rounded-xs border border-border/35 bg-accent/15 px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/20">
      <ServerAvatar server={server} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <NormalTooltip content={server.name} side="top">
            <span className="truncate text-foreground text-sm">{server.name}</span>
          </NormalTooltip>
          {inactive && (
            <span className="shrink-0 rounded-3xs bg-warning/10 px-1 py-px text-warning text-xs">
              {t('library.config.tools.inactive_badge')}
            </span>
          )}
        </div>
        {server.description && (
          <NormalTooltip content={<span className="whitespace-pre-wrap">{server.description}</span>} side="top">
            <div className="mt-0.5 truncate text-muted-foreground/55 text-xs">{server.description}</div>
          </NormalTooltip>
        )}
      </div>
      <NormalTooltip
        content={t(
          inactive ? 'library.config.tools.switch_title_inactive' : 'library.config.tools.switch_title_active'
        )}>
        <Switch
          size="sm"
          checked
          onCheckedChange={onToggle}
          classNames={{
            root: 'h-3.5 w-6 shrink-0 shadow-none',
            thumb: 'size-2.5 ml-0.5 data-[state=checked]:translate-x-3'
          }}
        />
      </NormalTooltip>
    </div>
  )
}

function ServerAvatar({ server, size }: { server: MCPServer; size: number }) {
  if (server.logoUrl) {
    return (
      <img
        src={server.logoUrl}
        alt=""
        className="shrink-0 rounded-2xs bg-accent/40 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-2xs bg-accent/50"
      style={{ width: size, height: size }}>
      <Wrench size={Math.round(size * 0.45)} strokeWidth={1.4} className="text-foreground/70" />
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
