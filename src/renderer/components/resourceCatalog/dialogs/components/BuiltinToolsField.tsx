import { Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import { CLAUDE_TOOL_CATEGORIES, type ClaudeToolCategory } from '@shared/ai/claudecode/toolRegistry'
import { COMPUTER_USE_TOOL_GROUP } from '@shared/ai/computerUseTools'
import type { AgentType } from '@shared/data/types/agent'
import type { BuiltinToolPolicyInfo } from '@shared/ipc/schemas/agent'

import { getAgentBuiltinTools } from './builtinTools'
import { CapabilityRow, type CapabilityRowAutoApprove } from './CapabilityList'

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

const toolIcon = <Wrench size={13} strokeWidth={1.5} className="text-muted-foreground" />

/**
 * Built-in tools of an Agent runtime, edited as the opt-out `disabledTools` set (empty = all on):
 * browser control and computer use first, then the runtime's tools grouped by category.
 * For Claude Code agents, each tool also has an Auto Approve switch that edits `allowedTools`
 * independently of enablement; tools with a fixed approval policy show that policy, locked.
 */
export function BuiltinToolsField({
  agentType,
  disabledTools,
  onDisabledToolsChange,
  allowedTools,
  onAllowedToolsChange,
  hasKnowledgeScope
}: {
  agentType: AgentType
  disabledTools: readonly string[]
  onDisabledToolsChange: (disabledTools: string[]) => void
  /** With `onAllowedToolsChange`, shows a per-tool Auto Approve switch (Claude Code agents). */
  allowedTools?: readonly string[]
  onAllowedToolsChange?: (allowedTools: string[]) => void
  /** The kb_* tools are only injected once a knowledge base is bound, so they are hidden until then. */
  hasKnowledgeScope: boolean
}) {
  const { t } = useTranslation()
  const [browserEnabled] = usePreference('app.browser.agent_control.enabled')
  const [computerUseEnabled] = usePreference('app.computer_use.agent_control.enabled')
  const disabled = useMemo(() => new Set(disabledTools), [disabledTools])
  const showAutoApprove = allowedTools !== undefined && onAllowedToolsChange !== undefined
  const allowed = useMemo(() => new Set(allowedTools ?? []), [allowedTools])
  const setEnabled = (id: string, enabled: boolean) => {
    onDisabledToolsChange(enabled ? disabledTools.filter((name) => name !== id) : [...disabledTools, id])
    if (!enabled && allowed.has(id)) onAllowedToolsChange?.((allowedTools ?? []).filter((name) => name !== id))
  }
  const setAutoApproved = (id: string, enabled: boolean) => {
    if (disabled.has(id)) return
    onAllowedToolsChange?.(enabled ? [...(allowedTools ?? []), id] : (allowedTools ?? []).filter((name) => name !== id))
  }

  // Effective approval policy of Cherry-owned MCP tools: 'auto' tools are always pre-approved and
  // 'required'/'delegation' tools always prompt, whatever `allowedTools` says. The switch shows
  // that truth, locked. Tools without a policy entry keep the editable switch.
  const [toolPolicies, setToolPolicies] = useState<ReadonlyMap<string, BuiltinToolPolicyInfo['approval']>>(new Map())
  useEffect(() => {
    if (!showAutoApprove) return
    let cancelled = false
    ipcApi
      .request('agent.list_builtin_tool_policies')
      .then((policies) => {
        if (!cancelled) setToolPolicies(new Map(policies.map((policy) => [policy.runtimeName, policy.approval])))
      })
      .catch(() => {
        // Without the policy the switches fall back to the persisted preference.
      })
    return () => {
      cancelled = true
    }
  }, [showAutoApprove])

  const autoApproveFor = (id: string): CapabilityRowAutoApprove | undefined => {
    if (!showAutoApprove) return undefined
    const label = t('settings.mcp.tools.autoApprove.label')
    const approval = toolPolicies.get(id)
    if (approval !== undefined) {
      return {
        label,
        checked: approval === 'auto',
        disabled: true,
        tooltip: t(
          approval === 'auto'
            ? 'settings.mcp.tools.autoApprove.tooltip.alwaysAuto'
            : 'settings.mcp.tools.autoApprove.tooltip.alwaysAsk'
        ),
        onToggle: () => {}
      }
    }
    const enabled = !disabled.has(id)
    return {
      label,
      checked: enabled && allowed.has(id),
      disabled: !enabled,
      tooltip: enabled ? undefined : t('settings.mcp.tools.autoApprove.tooltip.howToEnable'),
      onToggle: (next) => setAutoApproved(id, next)
    }
  }

  const sections = useMemo(() => {
    const tools = getAgentBuiltinTools(agentType, hasKnowledgeScope)
    return CLAUDE_TOOL_CATEGORIES.map((category) => ({
      category,
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: tools
        .filter((tool) => tool.category === category)
        .map((tool) => ({
          id: tool.id,
          name: t(tool.labelKey, tool.labelFallback ?? tool.id),
          description: t(tool.descriptionKey, tool.descriptionFallback ?? ''),
          icon: toolIcon
        }))
    })).filter((section) => section.items.length > 0)
  }, [agentType, hasKnowledgeScope, t])

  const groups = [
    {
      id: BROWSER_TOOL_GROUP,
      title: t('settings.browser.title'),
      name: t('settings.browser.control'),
      description: t('settings.browser.controlHelp'),
      available: browserEnabled,
      settingsPath: '/settings/browser' as const
    },
    {
      id: COMPUTER_USE_TOOL_GROUP,
      title: t('settings.computerUse.title'),
      name: t('settings.computerUse.control'),
      description: t('settings.computerUse.controlHelp'),
      available: computerUseEnabled,
      settingsPath: '/settings/computer-use' as const
    }
  ]

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {groups.map((group) => (
        <div key={group.id} className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-muted-foreground text-xs">{group.title}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 min-h-0 px-2 font-normal text-muted-foreground text-xs hover:text-foreground"
              onClick={() => openSettingsTab(group.settingsPath)}>
              {t('settings.title')}
            </Button>
          </div>
          <CapabilityRow
            item={{
              id: group.id,
              name: group.name,
              description: group.description,
              pickable: group.available,
              badge: group.available ? undefined : t('library.config.tools.inactive_badge')
            }}
            checked={group.available && !disabled.has(group.id)}
            onToggle={(enabled) => setEnabled(group.id, enabled)}
          />
        </div>
      ))}
      {sections.map((section) => (
        <div key={section.category} className="flex min-w-0 flex-col gap-2">
          <span className="font-medium text-muted-foreground text-xs">{section.label}</span>
          <div className="flex min-w-0 flex-col gap-1.5">
            {section.items.map((item) => (
              <CapabilityRow
                key={item.id}
                item={item}
                checked={!disabled.has(item.id)}
                onToggle={(enabled) => setEnabled(item.id, enabled)}
                autoApprove={autoApproveFor(item.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
