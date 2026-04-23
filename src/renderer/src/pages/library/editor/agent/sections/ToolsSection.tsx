import { Input } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { AgentDetail } from '@shared/data/types/agent'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { Network, Search, Sparkles, Wrench } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentFormState } from '../descriptor'
import { AddCatalogPopover, BoundCatalogList, type CatalogItem } from './catalogComponents'

interface Props {
  agent: AgentDetail
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
 * - **内置工具**: `agent.tools` (backend-filled catalog on GET `/agents/:id`);
 *   `form.allowedTools` is the approval whitelist. Enabled iff id in whitelist.
 * - **MCP Server**: `useQuery('/mcp-servers').items`; `form.mcps` stores bound
 *   ids. Inactive servers remain visible in the bound list (with a "未启用"
 *   badge) but are excluded from the add popover (`pickable: false`).
 * - **Skills**: `useInstalledSkills(agent.id).skills`; enablement lives on
 *   each skill row (`isEnabled`) and toggles via IPC — it is NOT part of
 *   `AgentBase`, so the save flow ignores it.
 */
const ToolsSection: FC<Props> = ({ agent, form, onChange }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ToolTab>('tools')
  const [search, setSearch] = useState('')
  const canManageSkills = Boolean(agent.id)

  // --- 内置工具 ----------------------------------------------------------------
  const builtinCatalog = useMemo<CatalogItem[]>(
    () =>
      (agent.tools ?? []).map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />
      })),
    [agent.tools]
  )
  const allowedIds = useMemo(() => new Set(form.allowedTools), [form.allowedTools])
  const boundBuiltin = useMemo(() => builtinCatalog.filter((it) => allowedIds.has(it.id)), [builtinCatalog, allowedIds])
  const enableBuiltin = (id: string) => onChange({ allowedTools: [...form.allowedTools, id] })
  const disableBuiltin = (id: string) => onChange({ allowedTools: form.allowedTools.filter((x) => x !== id) })

  // --- MCP Server --------------------------------------------------------------
  const { data: mcpData, isLoading: mcpLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo<MCPServer[]>(() => mcpData?.items ?? [], [mcpData])
  const mcpCatalog = useMemo<CatalogItem[]>(
    () =>
      mcpServers.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || s.baseUrl || s.command,
        icon: <MCPIcon server={s} size={28} />,
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
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">{t('library.config.agent.section.tools.title')}</h3>
        <p className="text-[10px] text-muted-foreground/55">{t('library.config.agent.section.tools.desc')}</p>
      </div>

      <div className="relative">
        <Search size={11} className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground/30" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('library.config.agent.section.tools.search_placeholder')}
          className="rounded-xl border-border/15 bg-accent/5 pl-8 text-[11px] placeholder:text-muted-foreground/30 focus:border-border/30 focus:bg-accent/10"
        />
      </div>

      <div className="flex items-center border-border/10 border-b pb-px">
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-3 py-1.5 text-[11px] transition-colors ${
                active ? 'text-foreground' : 'text-muted-foreground/45 hover:text-foreground/70'
              }`}>
              {tab.label}
              <span className={`ml-1.5 text-[9px] ${active ? 'text-muted-foreground/50' : 'text-muted-foreground/30'}`}>
                {tab.enabled}/{tab.total}
              </span>
              {active && (
                <motion.div
                  layoutId="agent-tools-tab"
                  className="absolute right-0 bottom-0 left-0 h-[1.5px] rounded-full bg-foreground/60"
                />
              )}
            </button>
          )
        })}

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

function MCPIcon({ server, size }: { server: MCPServer; size: number }) {
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
      <Network size={Math.round(size * 0.5)} strokeWidth={1.5} className="text-blue-500/60" />
    </div>
  )
}

export default ToolsSection
