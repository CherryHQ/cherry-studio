import type { ActionRegistry } from '../../actions/actionRegistry'
import { createActionRegistry } from '../../actions/actionRegistry'
import type { ActionDescriptor, CommandDescriptor } from '../../actions/actionTypes'
import type { ResourceListItemBase } from '../ResourceList'

export interface AssistantListActionContext<T extends ResourceListItemBase = ResourceListItemBase> {
  item: T
  pinned: boolean
  selected: boolean
  canPin?: boolean
  canEdit?: boolean
  canDelete?: boolean
}

export interface AssistantListActionHandlers<T extends ResourceListItemBase = ResourceListItemBase> {
  onSelect?: (item: T) => void | Promise<void>
  onTogglePin?: (item: T) => void | Promise<void>
  onEdit?: (item: T) => void | Promise<void>
  onDelete?: (item: T) => void | Promise<void>
}

export function createAssistantListActionRegistry<T extends ResourceListItemBase>(
  handlers: AssistantListActionHandlers<T>,
  labels: {
    select: string
    pin: string
    unpin: string
    edit: string
    delete: string
  }
): ActionRegistry<AssistantListActionContext<T>> {
  const registry = createActionRegistry<AssistantListActionContext<T>>()

  const commands: CommandDescriptor<AssistantListActionContext<T>>[] = [
    {
      id: 'assistant.select',
      run: ({ item }) => handlers.onSelect?.(item)
    },
    {
      id: 'assistant.toggle-pin',
      availability: ({ canPin }) => ({ enabled: canPin !== false }),
      run: ({ item }) => handlers.onTogglePin?.(item)
    },
    {
      id: 'assistant.edit',
      availability: ({ canEdit }) => ({ enabled: canEdit !== false }),
      run: ({ item }) => handlers.onEdit?.(item)
    },
    {
      id: 'assistant.delete',
      availability: ({ canDelete }) => ({ enabled: canDelete === true }),
      run: ({ item }) => handlers.onDelete?.(item)
    }
  ]

  const actions: ActionDescriptor<AssistantListActionContext<T>>[] = [
    {
      id: 'assistant.select',
      commandId: 'assistant.select',
      label: labels.select,
      order: 10,
      surface: 'menu'
    },
    {
      id: 'assistant.pin',
      commandId: 'assistant.toggle-pin',
      label: ({ pinned }) => (pinned ? labels.unpin : labels.pin),
      order: 20,
      surface: 'menu'
    },
    {
      id: 'assistant.edit',
      commandId: 'assistant.edit',
      label: labels.edit,
      order: 30,
      surface: 'menu'
    },
    {
      id: 'assistant.delete',
      commandId: 'assistant.delete',
      label: labels.delete,
      danger: true,
      order: 40,
      surface: 'menu'
    }
  ]

  commands.forEach((command) => registry.registerCommand(command))
  actions.forEach((action) => registry.registerAction(action))

  return registry
}
