import { SegmentedControl } from '@cherrystudio/ui'
import { type CatalogItem, CatalogToggleGrid } from '@renderer/components/resource/dialogs/components/CatalogPicker'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import {
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory,
  claudeUserFacingTools
} from '@shared/ai/claudecode/toolRegistry'
import { type ReactNode, useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

// Mirror of the edit dialog's category labels — kept inline to avoid refactoring
// the (working) AgentEditDialog. Small enough that duplication beats a shared abstraction.
const CATEGORY_LABEL_KEYS: Record<ClaudeToolCategory, string> = {
  file: 'library.config.agent.section.tools.category.file',
  shell: 'library.config.agent.section.tools.category.shell',
  search: 'library.config.agent.section.tools.category.search',
  context: 'library.config.agent.section.tools.category.context',
  orchestration: 'library.config.agent.section.tools.category.orchestration',
  media: 'library.config.agent.section.tools.category.media'
}
const CATEGORY_LABEL_FALLBACKS: Record<ClaudeToolCategory, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  context: 'Context',
  orchestration: 'Orchestration',
  media: 'Media'
}

type CapabilityTab = 'all' | 'skill' | 'tools' | 'mcp'

function GroupSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <div className="font-medium text-foreground/70 text-sm">{title}</div>
      {children}
    </div>
  )
}

type CapabilityStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 3 (agent): capability configuration. Tabs (All / Skill / Tools / MCP)
 * over title-only multi-select checkbox grids, mapping to `disabledTools`
 * (opt-out), `mcps`, and `skillIds` on the form. The All tab groups every
 * capability by type.
 */
export function CapabilityStep({ form, portalContainer }: CapabilityStepProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CapabilityTab>('all')

  // ---- Builtin tools (opt-out via `disabledTools`) ----
  const disabledTools = form.watch('disabledTools')
  const disabledSet = useMemo(() => new Set(disabledTools), [disabledTools])
  const builtinSections = useMemo(() => {
    const tools = claudeUserFacingTools()
    return CLAUDE_TOOL_CATEGORIES.map((category) => ({
      category,
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: tools
        .filter((tool) => tool.category === category)
        .map<CatalogItem>((tool) => ({ id: tool.name, name: t(`agent.tools.builtin.${tool.key}.label`, tool.label) }))
    })).filter((section) => section.items.length > 0)
  }, [t])
  const enabledToolIds = useMemo<ReadonlySet<string>>(
    () => new Set(builtinSections.flatMap((s) => s.items.map((i) => i.id)).filter((id) => !disabledSet.has(id))),
    [builtinSections, disabledSet]
  )
  const setToolEnabled = (name: string, enabled: boolean) =>
    form.setValue('disabledTools', enabled ? disabledTools.filter((n) => n !== name) : [...disabledTools, name], {
      shouldDirty: true
    })

  // ---- MCP servers (title only) ----
  const mcps = form.watch('mcps')
  const mcpIds = useMemo(() => new Set(mcps), [mcps])
  const { data: mcpData, isLoading: mcpLoading } = useQuery('/mcp-servers', {})
  const mcpCatalog = useMemo<CatalogItem[]>(
    () => (mcpData?.items ?? []).map((server) => ({ id: server.id, name: server.name })),
    [mcpData]
  )
  const toggleMcp = (id: string, enabled: boolean) =>
    form.setValue('mcps', enabled ? [...mcps, id] : mcps.filter((mcpId) => mcpId !== id), { shouldDirty: true })

  // ---- Skills (global library; selection stored as create-only `skillIds`) ----
  const skillIds = form.watch('skillIds')
  const { skills, loading: skillsLoading } = useInstalledSkills()
  const skillCatalog = useMemo<CatalogItem[]>(
    () => skills.map((skill) => ({ id: skill.id, name: skill.name })),
    [skills]
  )
  const enabledSkillIds = useMemo(() => new Set(skillIds), [skillIds])
  const toggleSkill = (id: string, enabled: boolean) =>
    form.setValue('skillIds', enabled ? [...skillIds, id] : skillIds.filter((s) => s !== id), { shouldDirty: true })

  const toolsBlock = (
    <div className="grid gap-5">
      {builtinSections.map((section) => (
        <div key={section.category} className="grid gap-2">
          <div className="font-medium text-foreground/55 text-xs">{section.label}</div>
          <CatalogToggleGrid
            items={section.items}
            enabledIds={enabledToolIds}
            onToggle={setToolEnabled}
            emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
            portalContainer={portalContainer}
            variant="checkbox"
          />
        </div>
      ))}
    </div>
  )

  const mcpBlock = (
    <CatalogToggleGrid
      items={mcpCatalog}
      enabledIds={mcpIds}
      loading={mcpLoading}
      onToggle={toggleMcp}
      emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
      portalContainer={portalContainer}
      variant="checkbox"
    />
  )

  const skillsBlock = (
    <CatalogToggleGrid
      items={skillCatalog}
      enabledIds={enabledSkillIds}
      loading={skillsLoading}
      onToggle={toggleSkill}
      emptyLabel={t('library.config.dialogs.create.capability.no_skills')}
      portalContainer={portalContainer}
      variant="checkbox"
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl<CapabilityTab>
        size="sm"
        className="self-start"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: 'all', label: t('library.config.dialogs.create.capability.tab.all') },
          { value: 'skill', label: t('library.config.dialogs.create.capability.tab.skill') },
          { value: 'tools', label: t('library.config.dialogs.create.capability.tab.tools') },
          { value: 'mcp', label: t('library.config.dialogs.create.capability.tab.mcp') }
        ]}
      />

      {tab === 'all' ? (
        <div className="grid gap-6">
          <GroupSection title={t('library.config.dialogs.create.capability.tab.tools')}>{toolsBlock}</GroupSection>
          <GroupSection title={t('library.config.dialogs.create.capability.tab.mcp')}>{mcpBlock}</GroupSection>
          <GroupSection title={t('library.config.dialogs.create.capability.tab.skill')}>{skillsBlock}</GroupSection>
        </div>
      ) : null}
      {tab === 'tools' ? toolsBlock : null}
      {tab === 'mcp' ? mcpBlock : null}
      {tab === 'skill' ? skillsBlock : null}
    </div>
  )
}
