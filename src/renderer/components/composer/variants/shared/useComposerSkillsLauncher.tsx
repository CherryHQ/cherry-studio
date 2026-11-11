import { ToolCase } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useComposerToolDispatch } from '@renderer/components/composer/ComposerToolRuntime'
import { prepareComposerQuickPanelSearch } from '@renderer/components/composer/quickPanel'
import type { ComposerToolFooterAction, ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import {
  type QuickPanelInputAdapter,
  type QuickPanelListItem,
  useOptionalQuickPanel
} from '@renderer/components/QuickPanel'
import type { LocalSkill } from '@shared/types/skill'

import { agentComposerTokenId } from '../agentComposerTokens'

const logger = loggerService.withContext('ComposerSkillsLauncher')
export const AGENT_SKILLS_LAUNCHER_ID = 'agent-skills'
const EMPTY_FOOTER_ACTIONS: ComposerToolFooterAction[] = []

export function useComposerSkillsLauncher({
  skills,
  refresh,
  onInsertSkill,
  footerActions = EMPTY_FOOTER_ACTIONS,
  active = true,
  disabled = false
}: {
  skills: readonly LocalSkill[]
  refresh: () => Promise<unknown>
  onInsertSkill: (skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => void
  footerActions?: ComposerToolFooterAction[]
  active?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { toolsRegistry } = useComposerToolDispatch()
  const quickPanel = useOptionalQuickPanel()
  const skillLabel = t('plugins.skills')
  const skillItems = useMemo<QuickPanelListItem[]>(
    () =>
      skills.map((skill) => ({
        id: agentComposerTokenId.skill(skill),
        label: skill.name,
        description: skill.description ?? undefined,
        icon: <ToolCase size={16} />,
        filterText: [skill.name, skill.description].filter(Boolean).join(' '),
        searchAliases: [skillLabel],
        disabled,
        action: ({ inputAdapter }) => {
          if (!disabled) onInsertSkill(skill, inputAdapter)
        }
      })),
    [skills, skillLabel, disabled, onInsertSkill]
  )
  const launcher = useMemo<ComposerToolLauncher>(
    () => ({
      id: AGENT_SKILLS_LAUNCHER_ID,
      kind: 'panel',
      sources: ['root-panel'],
      order: 40,
      label: skillLabel,
      icon: <ToolCase />,
      searchAliases: [skillLabel],
      panelSymbol: AGENT_SKILLS_LAUNCHER_ID,
      disabled,
      rootSearchItems: skillItems.map((item) => ({ ...item, suffix: skillLabel })),
      action: ({ inputAdapter, parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
        if (disabled) return
        void refresh().catch((error) => {
          logger.warn('Failed to refresh available skills when opening the skills panel', { error })
        })
        quickPanel.open({
          title: skillLabel,
          list: skillItems,
          symbol: AGENT_SKILLS_LAUNCHER_ID,
          parentPanel,
          ...prepareComposerQuickPanelSearch({ inputAdapter, queryAnchor, triggerInfo })
        })
      }
    }),
    [disabled, refresh, skillItems, skillLabel]
  )

  useEffect(
    () => toolsRegistry.registerLaunchers(AGENT_SKILLS_LAUNCHER_ID, [launcher], footerActions),
    [footerActions, launcher, toolsRegistry]
  )

  const visible = active && quickPanel?.isVisible && quickPanel.symbol === AGENT_SKILLS_LAUNCHER_ID
  const updateList = quickPanel?.updateList
  useEffect(() => {
    if (visible) updateList?.(skillItems)
  }, [visible, skillItems, updateList])
}
