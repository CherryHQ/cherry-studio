import { Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { platform } from '@renderer/utils/platform'
import { AGENT_RUNTIME_CAPABILITIES, type AgentRuntimeCapabilities } from '@shared/ai/agentRuntimeCapabilities'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import {
  CLAUDE_KNOWLEDGE_TOOL_NAMES,
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory
} from '@shared/ai/claudecode/toolRegistry'
import { COMPUTER_USE_TOOL_GROUP } from '@shared/ai/computerUseTools'
import type { AgentType } from '@shared/data/types/agent'

import { CapabilityRow } from './CapabilityList'

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
 * Approval is governed by the permission mode, not here.
 */
export function BuiltinToolsField({
  agentType,
  disabledTools,
  onDisabledToolsChange,
  hasKnowledgeScope
}: {
  agentType: AgentType
  disabledTools: readonly string[]
  onDisabledToolsChange: (disabledTools: string[]) => void
  /** The kb_* tools are only injected once a knowledge base is bound, so they are hidden until then. */
  hasKnowledgeScope: boolean
}) {
  const { t } = useTranslation()
  const [browserEnabled] = usePreference('app.browser.agent_control.enabled')
  const [computerUseEnabled] = usePreference('app.computer_use.agent_control.enabled')
  const disabled = useMemo(() => new Set(disabledTools), [disabledTools])
  const setEnabled = (id: string, enabled: boolean) =>
    onDisabledToolsChange(enabled ? disabledTools.filter((name) => name !== id) : [...disabledTools, id])

  const sections = useMemo(() => {
    const caps: AgentRuntimeCapabilities = AGENT_RUNTIME_CAPABILITIES[agentType]
    const tools = caps
      .builtinTools(platform)
      .filter((tool) => !caps.knowledgeBases || hasKnowledgeScope || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
