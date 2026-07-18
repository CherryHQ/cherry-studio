import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  buildIconTypeActionDescriptors,
  buildResourceEntityIconTypeActionDescriptor,
  buildResourceEntityMenuActionDescriptor,
  RESOURCE_ICON_TYPE_OPTIONS
} from '@renderer/components/chat/resourceList/base'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import { BrushCleaning, Edit3, PinIcon, PinOffIcon, Smile, Tags, Trash2 } from 'lucide-react'

export interface AssistantGroupActionContext {
  assistantId: string
  assistantIconType: AssistantIconType
  deleteAssistantDisabled?: boolean
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  isTagGrouping: boolean
  onDeleteAssistant: (assistantId: string) => void | Promise<void>
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onSetAssistantIconType: (iconType: AssistantIconType) => void | Promise<void>
  onToggleTagGrouping: () => void | Promise<void>
  onTogglePin: (assistantId: string) => void | Promise<void>
  pinned: boolean
  t: TFunction
}

export type AssistantGroupAction = ResolvedAction<AssistantGroupActionContext>

const assistantGroupActionRegistry = createActionRegistry<AssistantGroupActionContext>()

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.edit',
  run: ({ assistantId, onEdit }) => {
    onEdit(assistantId)
  }
})

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.toggle-pin',
  availability: ({ disabled }) => ({ enabled: !disabled }),
  run: ({ assistantId, onTogglePin }) => onTogglePin(assistantId)
})

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.delete-topics',
  availability: ({ deleteTopicsDisabled }) => ({ enabled: !deleteTopicsDisabled }),
  run: ({ assistantId, onDeleteAllTopics }) => onDeleteAllTopics(assistantId)
})

for (const type of RESOURCE_ICON_TYPE_OPTIONS) {
  assistantGroupActionRegistry.registerCommand({
    id: `assistant-group.set-icon-type.${type}`,
    run: ({ onSetAssistantIconType }) => onSetAssistantIconType(type)
  })
}

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.toggle-tag-grouping',
  run: ({ onToggleTagGrouping }) => onToggleTagGrouping()
})

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.delete-assistant',
  availability: ({ deleteAssistantDisabled }) => ({ enabled: !deleteAssistantDisabled }),
  run: ({ assistantId, onDeleteAssistant }) => onDeleteAssistant(assistantId)
})

assistantGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'assistant-group.edit',
    commandId: 'assistant-group.edit',
    label: ({ t }) => t('assistants.edit.title'),
    icon: () => <Edit3 size={14} />,
    order: 10
  })
)

assistantGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'assistant-group.toggle-pin',
    commandId: 'assistant-group.toggle-pin',
    label: ({ pinned, t }) => (pinned ? t('assistants.unpin.title') : t('assistants.pin.title')),
    icon: ({ pinned }) => (pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
    order: 20
  })
)

assistantGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'assistant-group.delete-topics',
    commandId: 'assistant-group.delete-topics',
    label: ({ t }) => t('assistants.clear.menu_title'),
    icon: () => <BrushCleaning size={14} />,
    order: 25
  })
)

assistantGroupActionRegistry.registerAction(
  buildResourceEntityIconTypeActionDescriptor({
    id: 'assistant-group.icon-type',
    label: ({ t }) => t('assistants.icon.type'),
    icon: () => <Smile size={14} />,
    order: 30,
    children: buildIconTypeActionDescriptors<AssistantGroupActionContext>('assistant-group.set-icon-type')
  })
)

assistantGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'assistant-group.toggle-tag-grouping',
    commandId: 'assistant-group.toggle-tag-grouping',
    label: ({ isTagGrouping, t }) => (isTagGrouping ? t('assistants.tags.ungroup') : t('assistants.tags.group_by')),
    icon: () => <Tags size={14} />,
    order: 35
  })
)

assistantGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'assistant-group.delete-assistant',
    commandId: 'assistant-group.delete-assistant',
    label: ({ t }) => t('assistants.delete.title'),
    icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
    group: 'danger',
    order: 40,
    danger: true
  })
)

export function resolveAssistantGroupActions(context: AssistantGroupActionContext): AssistantGroupAction[] {
  return assistantGroupActionRegistry.resolve(context, 'menu')
}

export async function executeAssistantGroupAction(
  action: AssistantGroupAction,
  context: AssistantGroupActionContext
): Promise<boolean> {
  return assistantGroupActionRegistry.execute(action.id, context)
}
