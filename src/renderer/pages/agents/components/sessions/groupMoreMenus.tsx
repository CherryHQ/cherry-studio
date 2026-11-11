import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { ResourceList, type ResourceListGroup } from '@renderer/components/chat/resourceList/base'
import { CommandPopupMenu } from '@renderer/components/command'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'

import { type AgentGroupActionContext, executeAgentGroupAction, resolveAgentGroupActions } from './agentGroupActions'
import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from './workdirGroupActions'

export function AgentGroupMoreMenu({
  agentId,
  isLocalAgent,
  assistantIconType,
  deleteAgentDisabled,
  deleteSessionsOnly,
  pinDisabled,
  pinned,
  onArchiveSessions,
  onDeleteAgent,
  onEdit,
  onPermanentDeleteAgent,
  onSetAgentIconType,
  onTogglePin,
  onToggleSidebar,
  permanentDeleteShortcut,
  sidebarPinned
}: {
  agentId: string
  isLocalAgent: boolean
  assistantIconType: AssistantIconType
  deleteAgentDisabled?: boolean
  deleteSessionsOnly?: boolean
  pinDisabled?: boolean
  pinned: boolean
  sidebarPinned: boolean
  onArchiveSessions: (agentId: string) => void | Promise<void>
  onDeleteAgent: (agentId: string) => void | Promise<void>
  onEdit: (agentId: string) => void
  onPermanentDeleteAgent?: (agentId: string) => void | Promise<void>
  onSetAgentIconType: (iconType: AssistantIconType) => void | Promise<void>
  onTogglePin: (agentId: string) => void | Promise<void>
  onToggleSidebar: (agentId: string) => void | Promise<void>
  permanentDeleteShortcut?: string
}) {
  const { t } = useTranslation()
  const actionContext: AgentGroupActionContext = {
    agentId,
    isLocalAgent,
    assistantIconType,
    deleteAgentDisabled,
    deleteSessionsOnly,
    onArchiveSessions,
    onDeleteAgent,
    onEdit,
    onPermanentDeleteAgent,
    onSetAgentIconType,
    onTogglePin,
    onToggleSidebar,
    permanentDeleteShortcut,
    pinDisabled,
    pinned,
    sidebarPinned,
    t
  }
  const actions = resolveAgentGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeAgentGroupAction(action, actionContext)
  })

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
      <ResourceList.GroupHeaderActionButton
        type="button"
        aria-label={t('common.more')}
        onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="block" />
      </ResourceList.GroupHeaderActionButton>
    </CommandPopupMenu>
  )
}

export function WorkdirGroupMoreMenu({
  canPin,
  pinned,
  pinDisabled,
  onTogglePin,
  canDelete,
  canRename,
  deleteDisabled,
  group,
  onDelete,
  onOpen,
  onRename,
  renameDisabled,
  workdirPath
}: {
  canDelete: boolean
  canRename: boolean
  canPin: boolean
  pinned: boolean
  pinDisabled?: boolean
  onTogglePin: (group: ResourceListGroup) => void | Promise<void>
  deleteDisabled?: boolean
  group: ResourceListGroup
  onDelete: (group: ResourceListGroup) => void | Promise<void>
  onOpen: (workdirPath: string) => void | Promise<void>
  onRename: (group: ResourceListGroup) => void | Promise<void>
  renameDisabled?: boolean
  workdirPath: string
}) {
  const { t } = useTranslation()
  const actionContext: WorkdirGroupActionContext = {
    canPin,
    pinned,
    pinDisabled,
    onTogglePin,
    canDelete,
    canRename,
    deleteDisabled,
    group,
    onDelete,
    onOpen,
    onRename,
    renameDisabled,
    t,
    workdirPath
  }
  const actions = resolveWorkdirGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeWorkdirGroupAction(action, actionContext)
  })

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
      <ResourceList.GroupHeaderActionButton
        type="button"
        aria-label={t('common.more')}
        onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="block" />
      </ResourceList.GroupHeaderActionButton>
    </CommandPopupMenu>
  )
}
