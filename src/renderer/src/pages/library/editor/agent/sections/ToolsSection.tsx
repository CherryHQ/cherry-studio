import { Input, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { permissionModeCards } from '@renderer/config/agent'
import {
  computeModeDefaults,
  mergeAutoApprovedTools,
  normalizePermissionMode,
  uniq
} from '@renderer/hooks/agents/permissionMode'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { Tool } from '@renderer/types'
import type { AgentDetail } from '@shared/data/types/agent'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { Network, Search, Sparkles, Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
 * Agent "能力扩展" editor — mirrors the legacy AgentSettings Tools/MCP/Skills
 * tabs collapsed into one section with three sub-tabs. Each sub-tab follows
 * the same interaction pattern (reused via `BoundCatalogList` +
 * `AddCatalogPopover`): the list area shows only currently-enabled items,
 * "+ 添加" opens a popover listing the rest.
 *
 * Data sources:
 * - **内置工具**: `tools` prop from `useAgentTools(form.mcps)`;
 *   `form.allowedTools` stores manual approvals, while permission mode supplies auto-approved defaults.
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
  const permissionMode = normalizePermissionMode(form.permissionMode)
  const selectedModeCard = useMemo(
    () => permissionModeCards.find((card) => card.mode === permissionMode),
    [permissionMode]
  )
  const autoToolIds = useMemo(() => computeModeDefaults(permissionMode, tools), [permissionMode, tools])
  const builtinCatalog = useMemo<CatalogItem[]>(
    () =>
      tools
        .filter((tool) => tool.type !== 'mcp')
        .map((tool) => {
          const isAuto = autoToolIds.includes(tool.id)
          const modeName = selectedModeCard
            ? t(selectedModeCard.titleKey, selectedModeCard.titleFallback)
            : permissionMode
          return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />,
            statusBadge: isAuto ? t('agent.settings.tooling.preapproved.autoBadge', 'Added by mode') : undefined,
            statusBadgeClassName: isAuto ? 'bg-success/10 text-success' : undefined,
            disableToggle: isAuto,
            disabledReason: isAuto
              ? t('agent.settings.tooling.preapproved.autoDisabledTooltip', { mode: modeName })
              : undefined
          }
        }),
    [autoToolIds, permissionMode, selectedModeCard, t, tools]
  )
  const approvedToolIds = useMemo(
    () => mergeAutoApprovedTools(form.allowedTools, permissionMode, tools),
    [form.allowedTools, permissionMode, tools]
  )
  const allowedIds = useMemo(() => new Set(approvedToolIds), [approvedToolIds])
  const boundBuiltin = useMemo(() => builtinCatalog.filter((it) => allowedIds.has(it.id)), [builtinCatalog, allowedIds])
  const enableBuiltin = (id: string) => onChange({ allowedTools: uniq([...approvedToolIds, id]) })
  const disableBuiltin = (id: string) => {
    if (autoToolIds.includes(id)) return
    onChange({ allowedTools: uniq(approvedToolIds.filter((x) => x !== id).concat(autoToolIds)) })
  }

  // --- MCP Server --------------------------------------------------------------
  const { data: mcpData, isLoading: mcpLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo<MCPServer[]>(() => mcpData?.items ?? [], [mcpData])
  const mcpCatalog = useMemo<CatalogItem[]>(
    () =>
      mcpServers.map((s) => ({
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
        // Hide inactive servers from the picker — same rule as assistant MCP.
        pickable: s.isActive
      })),
    [mcpServers, t]
  )
  const mcpIds = useMemo(() => new Set(form.mcps), [form.mcps])
  const boundMCP = useMemo(() => mcpCatalog.filter((it) => mcpIds.has(it.id)), [mcpCatalog, mcpIds])
  const enableMCP = (id: string) => onChange({ mcps: [...form.mcps, id] })
  const disableMCP = (id: string) => onChange({ mcps: form.mcps.filter((x) => x !== id) })

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
  const flipSkill = (id: string, nextEnabled: boolean) => {
    void toggleSkill(id, nextEnabled)
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
      enabled: boundMCP.length,
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
          className="rounded-xs border-border/20 bg-accent/15 pl-8 text-xs placeholder:text-muted-foreground/80 focus:border-border/40 focus:bg-accent/20"
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
            enabledIds={allowedIds}
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
            onAdd={enableMCP}
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
            items={boundMCP}
            loading={mcpLoading}
            search={search}
            onDisable={disableMCP}
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
