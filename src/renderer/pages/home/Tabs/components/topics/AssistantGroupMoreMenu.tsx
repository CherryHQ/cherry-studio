import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import { CommandPopupMenu } from '@renderer/components/command'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'

import {
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from './assistantGroupActions'

export function AssistantGroupMoreMenu({
  assistantId,
  assistantIconType,
  deleteAssistantDisabled,
  deleteTopicsDisabled,
  disabled,
  isGroupGrouping,
  pinned,
  sidebarPinned,
  onDeleteAssistant,
  onDeleteAllTopics,
  onPermanentDeleteAssistant,
  permanentDeleteShortcut,
  onEdit,
  onSetAssistantIconType,
  onToggleGrouping,
  onTogglePin,
  onToggleSidebar
}: {
  assistantId: string
  assistantIconType: AssistantIconType
  deleteAssistantDisabled?: boolean
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  isGroupGrouping: boolean
  pinned: boolean
  sidebarPinned: boolean
  onDeleteAssistant: (assistantId: string) => void | Promise<void>
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onPermanentDeleteAssistant?: (assistantId: string) => void | Promise<void>
  permanentDeleteShortcut?: string
  onEdit: (assistantId: string) => void
  onSetAssistantIconType: (iconType: AssistantIconType) => void | Promise<void>
  onToggleGrouping: () => void | Promise<void>
  onTogglePin: (assistantId: string) => void | Promise<void>
  onToggleSidebar: (assistantId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AssistantGroupActionContext = {
    assistantId,
    assistantIconType,
    deleteAssistantDisabled,
    deleteTopicsDisabled,
    disabled,
    isGroupGrouping,
    onDeleteAssistant,
    onDeleteAllTopics,
    onPermanentDeleteAssistant,
    permanentDeleteShortcut,
    onEdit,
    onSetAssistantIconType,
    onToggleGrouping,
    onTogglePin,
    onToggleSidebar,
    pinned,
    sidebarPinned,
    t
  }
  const actions = resolveAssistantGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeAssistantGroupAction(action, actionContext)
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
