import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { popup } from '@renderer/services/popup'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { getSelectionActionAgent, type SelectionActionAgentIssue } from '@renderer/utils/selectionAction'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import {
  type AskAgentSelectionAction,
  type CustomSelectionAction,
  SELECTION_BUILTIN_ACTION_ID,
  type SelectionAction
} from '@shared/types/selection'

import { DEFAULT_SEARCH_ENGINES } from '../components/SelectionActionSearchModal'

const logger = loggerService.withContext('useSettingsActionsList')

export interface SelectionActionAgentInfo {
  agent: { emoji: string; name: string } | undefined
  issue: SelectionActionAgentIssue | null
}

const MAX_CUSTOM_ITEMS = 10
const MAX_ENABLED_ITEMS = 8

export const ACTIONS_DIVIDER = '__actions_divider__'
export type ActionRow = SelectionAction | typeof ACTIONS_DIVIDER

const isActionItem = (row: ActionRow): row is SelectionAction => row !== ACTIONS_DIVIDER

export const actionItemsFromRows = (rows: ActionRow[]): SelectionActionItem[] => {
  const dividerIndex = rows.indexOf(ACTIONS_DIVIDER)
  const enabled = rows.slice(0, dividerIndex).filter(isActionItem)
  const disabled = rows.slice(dividerIndex + 1).filter(isActionItem)
  return [
    ...enabled.slice(0, MAX_ENABLED_ITEMS).map((item) => ({ ...item, enabled: true })),
    ...[...disabled, ...enabled.slice(MAX_ENABLED_ITEMS)].map((item) => ({ ...item, enabled: false }))
  ]
}

export const useActionItems = (
  initialItems: SelectionAction[] | undefined,
  setActionItems: (items: SelectionActionItem[]) => void
) => {
  const { t } = useTranslation()
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isAskAgentModalOpen, setIsAskAgentModalOpen] = useState(false)
  const [userEditingAction, setUserEditingAction] = useState<CustomSelectionAction | null>(null)
  const { agents, isLoading: agentsLoading } = useAgents()

  const enabledItems = useMemo(() => initialItems?.filter((item) => item.enabled) ?? [], [initialItems])
  const disabledItems = useMemo(() => initialItems?.filter((item) => !item.enabled) ?? [], [initialItems])
  const customItemsCount = useMemo(() => initialItems?.filter((item) => !item.isBuiltIn).length ?? 0, [initialItems])

  const handleEditActionItem = (item: SelectionAction) => {
    if (item.isBuiltIn) {
      if (item.id === SELECTION_BUILTIN_ACTION_ID.SEARCH) {
        setIsSearchModalOpen(true)
        return
      }
      if (item.id === SELECTION_BUILTIN_ACTION_ID.ASK_AGENT) {
        setIsAskAgentModalOpen(true)
        return
      }
      return
    }
    setUserEditingAction(item)
    setIsUserModalOpen(true)
  }

  const handleAddNewAction = () => {
    if (customItemsCount >= MAX_CUSTOM_ITEMS) return
    setUserEditingAction(null)
    setIsUserModalOpen(true)
  }

  const handleUserModalOk = (actionItem: CustomSelectionAction) => {
    if (userEditingAction && initialItems) {
      const updatedItems = initialItems.map((item) => (item.id === userEditingAction.id ? actionItem : item))
      setActionItems(updatedItems)
    } else {
      try {
        const currentItems = initialItems || []
        setActionItems([...currentItems, actionItem])
      } catch (error) {
        logger.debug('Error adding item:', error as Error)
      }
    }
    setIsUserModalOpen(false)
  }

  const handleSearchModalOk = (searchEngine: string) => {
    if (!initialItems) return
    const updatedItems = initialItems.map((item) =>
      item.isBuiltIn && item.id === SELECTION_BUILTIN_ACTION_ID.SEARCH ? { ...item, searchEngine } : item
    )
    setActionItems(updatedItems)
    setIsSearchModalOpen(false)
  }

  const handleAskAgentModalOk = (binding: Pick<AskAgentSelectionAction, 'agentId' | 'agentWorkspace'>) => {
    if (!initialItems) return
    setActionItems(
      initialItems.map((item) =>
        item.isBuiltIn && item.id === SELECTION_BUILTIN_ACTION_ID.ASK_AGENT ? { ...item, ...binding } : item
      )
    )
    setIsAskAgentModalOpen(false)
  }

  const handleDeleteActionItem = async (id: string) => {
    if (!initialItems) return
    const confirmed = await popup.confirm({
      centered: true,
      content: t('selection.settings.actions.delete_confirm')
    })
    if (!confirmed) return

    setActionItems(initialItems.filter((item) => item.id !== id))
  }

  const handleReset = async () => {
    if (!initialItems) return
    const confirmed = await popup.confirm({
      centered: true,
      content: t('selection.settings.actions.reset.confirm')
    })
    if (!confirmed) return

    const userItems = initialItems.filter((item) => !item.isBuiltIn).map((item) => ({ ...item, enabled: false }))
    setActionItems([...DefaultPreferences.default['feature.selection.action_items'], ...userItems])
  }

  const actionRows = useMemo<ActionRow[]>(
    () => [...enabledItems, ACTIONS_DIVIDER, ...disabledItems],
    [enabledItems, disabledItems]
  )

  const handleReorderRows = (rows: ActionRow[]) => {
    const nextItems = actionItemsFromRows(rows)
    // A drag that began before a rollback left its item as the last enabled one can still drop it below the divider.
    if (enabledItems.length > 0 && !nextItems.some((item) => item.enabled)) return
    setActionItems(nextItems)
  }

  const getSearchEngineInfo = (searchEngine: string) => {
    if (!searchEngine) return null
    const [engine] = searchEngine.split('|')
    const defaultEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === engine)
    if (defaultEngine) {
      return { icon: defaultEngine.icon, name: defaultEngine.label }
    }
    const customEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === 'custom')
    return { icon: customEngine?.icon, name: engine }
  }

  const getAgentInfo = (item: SelectionAction): SelectionActionAgentInfo | null => {
    const resolved = agentsLoading ? null : getSelectionActionAgent(item, agents)
    if (!resolved) return null
    const { agent, issue } = resolved
    if (!agent && !issue) return null
    return {
      agent: agent && { emoji: getAgentAvatarFromConfiguration(agent.configuration), name: agent.name },
      issue
    }
  }

  return {
    enabledItems,
    customItemsCount,
    isUserModalOpen,
    isSearchModalOpen,
    isAskAgentModalOpen,
    userEditingAction,
    setIsUserModalOpen,
    setIsSearchModalOpen,
    setIsAskAgentModalOpen,
    setUserEditingAction,
    handleEditActionItem,
    handleAddNewAction,
    handleUserModalOk,
    handleSearchModalOk,
    handleAskAgentModalOk,
    handleDeleteActionItem,
    handleReset,
    actionRows,
    handleReorderRows,
    getSearchEngineInfo,
    getAgentInfo,
    MAX_CUSTOM_ITEMS,
    MAX_ENABLED_ITEMS
  }
}
