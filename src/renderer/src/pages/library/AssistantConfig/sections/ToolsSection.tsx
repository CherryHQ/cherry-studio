import {
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
import type { AssistantSettings } from '@shared/data/types/assistant'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { AlertCircle, Plug, Plus, Search, Wrench } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'

type McpMode = AssistantSettings['mcpMode']

interface Props {
  mcpMode: McpMode
  mcpServerIds: string[]
  onModeChange: (mode: McpMode) => void
  onServerIdsChange: (ids: string[]) => void
}

const MODE_OPTIONS: { id: McpMode; label: string; desc: string }[] = [
  { id: 'disabled', label: '禁用', desc: '对话中不启用任何 MCP 工具' },
  { id: 'auto', label: '自动', desc: '由模型按需决定调用哪些已启用的 MCP 工具' },
  { id: 'manual', label: '手动', desc: '只暴露下方被勾选的 MCP 服务' }
]

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
        <h3 className="mb-1 text-[14px] text-foreground">工具</h3>
        <p className="text-[10px] text-muted-foreground/55">配置该助手在对话中可以调用的 MCP 服务</p>
      </div>

      <ModeGroup>
        {MODE_OPTIONS.map((o) => (
          <ModeRow
            key={o.id}
            label={o.label}
            desc={o.desc}
            active={mcpMode === o.id}
            onClick={() => onModeChange(o.id)}
          />
        ))}
      </ModeGroup>

      {mcpMode === 'manual' && (
        <div>
          <label className="mb-2 block text-[10px] text-muted-foreground/60">已添加的 MCP 服务</label>

          {isLoading ? (
            <p className="px-3 py-2 text-[10px] text-muted-foreground/40">加载中...</p>
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
              <button
                type="button"
                disabled={isLoading}
                className="mt-2 flex items-center gap-1 rounded-3xs border border-border/20 px-2.5 py-1.5 text-[10px] text-muted-foreground/60 transition-colors hover:border-border/40 hover:bg-accent/30 hover:text-foreground disabled:opacity-50">
                <Plus size={10} /> 添加 MCP 服务
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-64 rounded-2xs p-2">
              <div className="relative mb-2">
                <Search
                  size={10}
                  className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground/40"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索可用服务..."
                  className="h-auto rounded-3xs border border-border/20 bg-accent/10 py-1.5 pr-2 pl-6 text-[10px] shadow-none transition-all focus-visible:border-border/40 focus-visible:ring-0 md:text-[10px]"
                />
              </div>
              {availableForPicker.length === 0 ? (
                <p className="px-2 py-3 text-center text-[9px] text-muted-foreground/40">没有更多可用的服务</p>
              ) : (
                <Scrollbar className="max-h-60">
                  <MenuList>
                    {availableForPicker.map((s) => (
                      <MenuItem
                        key={s.id}
                        size="sm"
                        variant="ghost"
                        className="rounded-3xs"
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

      <div className="flex items-start gap-2 rounded-2xs border border-blue-500/15 bg-blue-500/5 px-3 py-2.5">
        <AlertCircle size={12} className="mt-px shrink-0 text-blue-500/50" />
        <div>
          <p className="text-[10px] text-blue-600/60 dark:text-blue-400/70">
            MCP (Model Context Protocol) 允许模型安全地调用外部工具。
          </p>
          <p className="mt-0.5 text-[9px] text-blue-600/40 dark:text-blue-400/50">
            仅启用必要的服务可以提高安全性和响应速度。
          </p>
        </div>
      </div>
    </div>
  )
}

function ServerCard({ server, onToggle }: { server: MCPServer; onToggle: () => void }) {
  const inactive = !server.isActive
  return (
    <div className="flex items-center gap-3 rounded-2xs border border-border/15 bg-accent/10 px-3 py-2.5 transition-colors hover:border-border/30">
      <ServerAvatar server={server} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <NormalTooltip content={server.name} side="top">
            <span className="truncate text-[11px] text-foreground">{server.name}</span>
          </NormalTooltip>
          {inactive && (
            <span className="shrink-0 rounded-4xs bg-warning/10 px-1 py-px text-[8px] text-warning">未启用</span>
          )}
        </div>
        {server.description && (
          <NormalTooltip content={<span className="whitespace-pre-wrap">{server.description}</span>} side="top">
            <div className="mt-0.5 truncate text-[9px] text-muted-foreground/45">{server.description}</div>
          </NormalTooltip>
        )}
      </div>
      <Switch
        size="sm"
        checked
        onCheckedChange={onToggle}
        title={inactive ? '该服务在 MCP 设置中未启用,移除后可重新添加' : '关闭以移除'}
        classNames={{
          root: 'h-3.5 w-6 shrink-0 shadow-none',
          thumb: 'size-2.5 ml-0.5 data-[state=checked]:translate-x-3'
        }}
      />
    </div>
  )
}

function ServerAvatar({ server, size }: { server: MCPServer; size: number }) {
  if (server.logoUrl) {
    return (
      <img
        src={server.logoUrl}
        alt=""
        className="shrink-0 rounded-3xs bg-accent/40 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-3xs bg-accent/50"
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
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-2.5 rounded-2xs border px-3 py-2.5 text-left transition-all ${
        active
          ? 'border-primary/35 bg-primary/[0.06] text-foreground'
          : 'border-border/15 bg-accent/10 text-muted-foreground/70 hover:bg-accent/25 hover:text-foreground'
      }`}>
      <span
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
          active ? 'bg-primary' : 'bg-muted-foreground/20'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px]">{label}</div>
        <div className="mt-0.5 text-[9px] text-muted-foreground/50">{desc}</div>
      </div>
    </button>
  )
}

function EmptyHint() {
  return (
    <div className="flex flex-col items-center rounded-2xs border border-border/20 border-dashed p-6">
      <Plug size={20} strokeWidth={1.2} className="mb-2 text-muted-foreground/20" />
      <p className="mb-1 text-[10px] text-muted-foreground/40">暂未添加 MCP 服务</p>
      <p className="text-[9px] text-muted-foreground/30">添加 MCP 服务后,助手可以调用外部工具</p>
    </div>
  )
}

export default ToolsSection
