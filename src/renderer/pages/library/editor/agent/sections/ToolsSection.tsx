import { Input, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { Tool } from '@shared/ai/tool'
import type { McpServer } from '@shared/data/types/mcpServer'
import { Network, Search, Sparkles, Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentDetail } from '../../../types'
import { AddCatalogPopover, BoundCatalogList, type CatalogItem } from '../../components/CatalogPicker'
import { McpServerAvatar } from '../../components/McpServerAvatar'
import type { AgentFormState } from '../descriptor'

interface Props {
  agent: AgentDetail
  tools: Tool[]
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

type ToolTab = 'tools' | 'mcp' | 'skills'

/**
 * Agent "能力扩展" editor with Tools/MCP/Skills sub-tabs. Each sub-tab follows
 * the same interaction pattern (reused via `BoundCatalogList` +
 * `AddCatalogPopover`): the list area shows only currently-enabled items,
 * "+ 添加" opens a popover listing the rest.
 *
 * Data sources:
 * - **内置工具**: `tools` prop from `useAgentTools(...)`;
 *   `form.disabledTools` stores the opt-out list; empty means all tools are enabled.
 * - **MCP Server**: `useQuery('/mcp-servers').items`; `form.mcps` stores bound
 *   ids. Inactive servers remain visible in the bound list (with a "未启用"
 *   badge) but are excluded from the add popover (`pickable: false`).
 * - **Skills**: `useInstalledSkills(agent.id).skills`; enablement lives on
 *   each skill row (`isEnabled`) and toggles via IPC — it is NOT part of
 *   `AgentBase`, so the save flow ignores it.
 */
const ToolsSection: FC<Props> = ({ agent, tools, form, onChange }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ToolTab>('tools')
  const [search, setSearch] = useState('')
  const canManageSkills = Boolean(agent.id)

  // --- 内置工具 ----------------------------------------------------------------
  const disabledToolIds = useMemo(() => new Set(form.disabledTools), [form.disabledTools])
  const builtinCatalog = useMemo<CatalogItem[]>(
    () =>
      tools
        .filter((tool) => tool.origin !== 'mcp')
        .map((tool) => {
          const isAuto = tool.approval === 'auto'
          return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />,
            statusBadge: isAuto ? t('agent.settings.tooling.preapproved.autoBadge', 'Added by mode') : undefined,
            statusBadgeClassName: isAuto ? 'bg-success/10 text-success' : undefined
          }
        }),
    [t, tools]
  )
  const enabledBuiltinIds = useMemo(
    () => new Set(builtinCatalog.filter((item) => !disabledToolIds.has(item.id)).map((item) => item.id)),
    [builtinCatalog, disabledToolIds]
  )
  const boundBuiltin = useMemo(
    () => builtinCatalog.filter((item) => enabledBuiltinIds.has(item.id)),
    [builtinCatalog, enabledBuiltinIds]
  )
  const enableBuiltin = (id: string) => onChange({ disabledTools: form.disabledTools.filter((x) => x !== id) })
  const disableBuiltin = (id: string) => {
    if (disabledToolIds.has(id)) return
    onChange({ disabledTools: [...form.disabledTools, id] })
  }

  // --- MCP Server --------------------------------------------------------------
  const { data: mcpData, isLoading: mcpLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo<McpServer[]>(() => mcpData?.items ?? [], [mcpData])
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const mcpCatalog = useMemo<CatalogItem[]>(
    () =>
      mcpServers.map((s) => {
        const status = mcpStatuses[s.id]
        const state = s.isActive ? (status?.state ?? 'connecting') : 'disabled'
        const statusBadge =
          state === 'connected'
            ? t('settings.mcp.runtimeStatus.connected', 'Connected')
            : state === 'connecting'
              ? t('settings.mcp.runtimeStatus.connecting', 'Connecting')
              : state === 'error'
                ? t('settings.mcp.runtimeStatus.unavailable', 'Unavailable')
                : undefined
        const statusBadgeClassName =
          state === 'connected'
            ? 'bg-success/10 text-success'
            : state === 'connecting'
              ? 'bg-warning/10 text-warning'
              : state === 'error'
                ? 'bg-destructive/10 text-destructive'
                : undefined
        return {
          id: s.id,
          name: s.name,
          description: s.description || s.baseUrl || s.command,
          icon: (
            <McpServerAvatar
              server={s}
              size={28}
              fallbackIcon={Network}
              fallbackIconClassName="text-blue-500/60"
              fallbackIconScale={0.5}
            />
          ),
          inactiveBadge: s.isActive ? undefined : t('library.config.tools.inactive_badge'),
          statusBadge,
          statusBadgeClassName,
          // Keep inactive servers visible for status, but do not allow binding them.
          pickable: s.isActive
        }
      }),
    [mcpServers, mcpStatuses, t]
  )
  const mcpIds = useMemo(() => new Set(form.mcps), [form.mcps])
  const boundMcp = useMemo(() => mcpCatalog.filter((it) => mcpIds.has(it.id)), [mcpCatalog, mcpIds])
  const enableMcp = (id: string) => onChange({ mcps: [...form.mcps, id] })
  const disableMcp = (id: string) => onChange({ mcps: form.mcps.filter((x) => x !== id) })

  // --- Skills -----------------------------------------------------------------
  const { skills, loading: skillsLoading, toggle: toggleSkill } = useInstalledSkills(agent.id || undefined)
  const skillCatalog = useMemo<CatalogItem[]>(
    () =>
      skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        icon: <Sparkles size={13} strokeWidth={1.5} className="text-amber-500/60" />
      })),
    [skills]
  )
  const enabledSkillIds = useMemo(() => new Set(skills.filter((s) => s.isEnabled).map((s) => s.id)), [skills])
  const boundSkills = useMemo(
    () => skillCatalog.filter((it) => enabledSkillIds.has(it.id)),
    [skillCatalog, enabledSkillIds]
  )
  const flipSkill = async (id: string, nextEnabled: boolean) => {
    try {
      await toggleSkill(id, nextEnabled)
    } catch {
      // toggleSkill already toasts/logs the failure inside useSkills; nothing
      // to do here besides keeping the rejection from bubbling as unhandled.
    }
  }

  // --- Tab metadata -----------------------------------------------------------
  const tabs: { id: ToolTab; label: string; enabled: number; total: number }[] = [
    {
      id: 'tools',
      label: t('library.config.agent.section.tools.tab.tools'),
      enabled: boundBuiltin.length,
      total: builtinCatalog.length
    },
    {
      id: 'mcp',
      label: t('library.config.agent.section.tools.tab.mcp'),
      enabled: boundMcp.length,
      total: mcpCatalog.length
    },
    {
      id: 'skills',
      label: t('library.config.agent.section.tools.tab.skills'),
      enabled: boundSkills.length,
      total: skillCatalog.length
    }
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.tools.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.tools.desc')}</p>
      </div>

      <div className="relative">
        <Search size={11} className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground/80" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('library.config.agent.section.tools.search_placeholder')}
          className="pl-8"
        />
      </div>

      <div className="flex items-center border-border/30 border-b pb-px">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ToolTab)} className="min-w-0">
          <TabsList className="h-auto justify-start gap-0 bg-transparent p-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="group relative h-auto rounded-lg border-0 bg-transparent px-3 py-1.5 font-normal text-muted-foreground/80 text-sm shadow-none transition-colors hover:bg-accent/30 hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent">
                {tab.label}
                <span className="ml-1.5 text-muted-foreground/80 text-xs group-data-[state=active]:text-muted-foreground/80">
                  {tab.enabled}/{tab.total}
                </span>
                <span className="absolute right-0 bottom-0 left-0 h-[1.5px] rounded-full bg-foreground/60 opacity-0 transition-opacity group-data-[state=active]:opacity-100" />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {activeTab === 'tools' && (
          <AddCatalogPopover
            items={builtinCatalog}
            enabledIds={enabledBuiltinIds}
            onAdd={enableBuiltin}
            disabled={builtinCatalog.length === 0}
            triggerLabel={t('library.config.agent.section.tools.add')}
            searchPlaceholder={t('library.config.tools.search')}
            emptyLabel={t('library.config.tools.no_more')}
          />
        )}
        {activeTab === 'mcp' && (
          <AddCatalogPopover
            items={mcpCatalog}
            enabledIds={mcpIds}
            onAdd={enableMcp}
            disabled={mcpLoading}
            triggerLabel={t('library.config.agent.section.tools.add')}
            searchPlaceholder={t('library.config.tools.search')}
            emptyLabel={t('library.config.tools.no_more')}
          />
        )}
        {activeTab === 'skills' && (
          <AddCatalogPopover
            items={skillCatalog}
            enabledIds={enabledSkillIds}
            onAdd={(id) => flipSkill(id, true)}
            disabled={!canManageSkills || skillsLoading}
            triggerLabel={t('library.config.agent.section.tools.add')}
            searchPlaceholder={t('library.config.tools.search')}
            emptyLabel={t('library.config.tools.no_more')}
          />
        )}
      </div>

      <div>
        {activeTab === 'tools' && (
          <BoundCatalogList
            items={boundBuiltin}
            search={search}
            onDisable={disableBuiltin}
            emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
            noMatchLabel={t('library.no_match')}
          />
        )}
        {activeTab === 'mcp' && (
          <BoundCatalogList
            items={boundMcp}
            loading={mcpLoading}
            search={search}
            onDisable={disableMcp}
            emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
            noMatchLabel={t('library.no_match')}
          />
        )}
        {activeTab === 'skills' && (
          <BoundCatalogList
            items={boundSkills}
            loading={skillsLoading}
            search={search}
            onDisable={(id) => flipSkill(id, false)}
            emptyLabel={
              canManageSkills
                ? t('library.config.agent.section.tools.no_skills_enabled')
                : t('library.config.agent.section.tools.skills_require_save')
            }
            noMatchLabel={t('library.no_match')}
          />
        )}
      </div>
    </div>
  )
}

export default ToolsSection
