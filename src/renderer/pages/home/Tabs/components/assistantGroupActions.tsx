import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { TFunction } from 'i18next'
import { Edit3, PinIcon, PinOffIcon, Trash2 } from 'lucide-react'

export interface AssistantGroupActionContext {
  assistantId: string
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onTogglePin: (assistantId: string) => void | Promise<void>
  pinned: boolean
  t: TFunction
}

export type AssistantGroupAction = ResolvedAction<AssistantGroupActionContext>

const assistantGroupActionRegistry = createActionRegistry<AssistantGroupActionContext>()

assistantGroupActionRegistry.registerCommand({
  id: 'assistant-group.edit',
  run: ({ assistantId, onEdit }) => {
    window.requestAnimationFrame(() => onEdit(assistantId))
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

assistantGroupActionRegistry.registerAction({
  id: 'assistant-group.edit',
  commandId: 'assistant-group.edit',
  label: ({ t }) => t('assistants.edit.title'),
  icon: () => <Edit3 size={14} />,
  order: 10,
  surface: 'menu'
})

assistantGroupActionRegistry.registerAction({
  id: 'assistant-group.toggle-pin',
  commandId: 'assistant-group.toggle-pin',
  label: ({ pinned, t }) => (pinned ? t('assistants.unpin.title') : t('assistants.pin.title')),
  icon: ({ pinned }) => (pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
  order: 20,
  surface: 'menu'
})

assistantGroupActionRegistry.registerAction({
  id: 'assistant-group.delete-topics',
  commandId: 'assistant-group.delete-topics',
  label: ({ t }) => t('assistants.clear.menu_title'),
  icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
  group: 'danger',
  order: 30,
  surface: 'menu',
  danger: true
})

export function resolveAssistantGroupActions(context: AssistantGroupActionContext): AssistantGroupAction[] {
  return assistantGroupActionRegistry.resolve(context, 'menu')
}

export async function executeAssistantGroupAction(
  action: AssistantGroupAction,
  context: AssistantGroupActionContext
): Promise<boolean> {
  return assistantGroupActionRegistry.execute(action.id, context)
}
