import { Switch } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { Wrench } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'

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
 * `settings.mcpMode`. The legacy page kept the two fields together; we follow
 * that shape because the server list is only meaningful in `manual` mode.
 */
const ToolsSection: FC<Props> = ({ mcpMode, mcpServerIds, onModeChange, onServerIdsChange }) => {
  // Direct useQuery (not useMCPServers) to keep this section self-contained and
  // avoid pulling in the `useMCPServers` module's top-level IPC listener for
  // URL-scheme installs — that's unrelated to assistant editing.
  const { data, isLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const toggleServer = (id: string) => {
    onServerIdsChange(mcpServerIds.includes(id) ? mcpServerIds.filter((x) => x !== id) : [...mcpServerIds, id])
  }

  const enabledCount = mcpServerIds.filter((id) => mcpServers.some((s) => s.id === id)).length

  return (
    <div className="max-w-2xl space-y-6">
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
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[10px] text-muted-foreground/60">可用 MCP 服务</label>
            {mcpServers.length > 0 && (
              <span className="text-[9px] text-muted-foreground/45 tabular-nums">
                {enabledCount} / {mcpServers.length} 已启用
              </span>
            )}
          </div>

          {isLoading ? (
            <p className="px-3 py-2 text-[10px] text-muted-foreground/40">加载中...</p>
          ) : mcpServers.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="space-y-1.5">
              {mcpServers.map((s) => {
                const enabled = mcpServerIds.includes(s.id)
                const disabled = !s.isActive
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-2xs border border-border/15 bg-accent/10 px-3 py-2 transition-opacity ${
                      enabled ? 'opacity-100' : 'opacity-80'
                    }`}>
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="truncate text-[11px] text-foreground">{s.name}</div>
                      {s.description && (
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/55">{s.description}</div>
                      )}
                      {s.baseUrl && (
                        <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/40">{s.baseUrl}</div>
                      )}
                    </div>
                    <Switch
                      checked={enabled && !disabled}
                      disabled={disabled}
                      onCheckedChange={() => toggleServer(s.id)}
                      title={disabled ? '请先在 MCP 设置中启用该服务' : undefined}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
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
    <div className="flex flex-col items-center justify-center rounded-2xs border border-border/20 border-dashed py-8">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xs bg-accent/30">
        <Wrench size={18} strokeWidth={1.3} className="text-muted-foreground/30" />
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground/60">暂无可用的 MCP 服务</p>
      <p className="text-[10px] text-muted-foreground/40">请前往「MCP 服务」设置页面添加并启用服务</p>
    </div>
  )
}

export default ToolsSection
