import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import type { TFunction } from 'i18next'
import { MenuIcon, PinIcon, PinOffIcon } from 'lucide-react'

export interface SessionActionContext {
  onDelete: () => void
  onTogglePin?: () => void
  pinned?: boolean
  sessionName: string
  setTopicPosition: (position: 'left' | 'right') => void
  startEdit: (value: string) => void
  t: TFunction
}

const sessionActionRegistry = createActionRegistry<SessionActionContext>()

sessionActionRegistry.registerCommand({
  id: 'session.rename',
  run: ({ sessionName, startEdit }) => startEdit(sessionName)
})

sessionActionRegistry.registerCommand({
  id: 'session.toggle-pin',
  availability: ({ onTogglePin }) => ({ visible: !!onTogglePin, enabled: !!onTogglePin }),
  run: ({ onTogglePin }) => onTogglePin?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.position-left',
  run: ({ setTopicPosition }) => setTopicPosition('left')
})

sessionActionRegistry.registerCommand({
  id: 'session.position-right',
  run: ({ setTopicPosition }) => setTopicPosition('right')
})

sessionActionRegistry.registerCommand({
  id: 'session.delete',
  run: ({ onDelete }) => onDelete()
})

sessionActionRegistry.registerAction({
  id: 'session.rename',
  commandId: 'session.rename',
  label: ({ t }) => t('common.rename'),
  icon: () => <EditIcon size={14} />,
  order: 10,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.toggle-pin',
  commandId: 'session.toggle-pin',
  label: ({ pinned, t }) => (pinned ? t('chat.topics.unpin') : t('chat.topics.pin')),
  icon: ({ pinned }) => (pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
  order: 20,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.position',
  label: ({ t }) => t('settings.topic.position.label'),
  icon: () => <MenuIcon size={14} />,
  order: 30,
  surface: 'menu',
  children: [
    {
      id: 'session.position-left',
      commandId: 'session.position-left',
      label: ({ t }) => t('settings.topic.position.left'),
      order: 10,
      surface: 'menu'
    },
    {
      id: 'session.position-right',
      commandId: 'session.position-right',
      label: ({ t }) => t('settings.topic.position.right'),
      order: 20,
      surface: 'menu'
    }
  ]
})

sessionActionRegistry.registerAction({
  id: 'session.delete',
  commandId: 'session.delete',
  label: ({ t }) => t('common.delete'),
  icon: () => <DeleteIcon size={14} className="lucide-custom" />,
  group: 'danger',
  order: 40,
  surface: 'menu',
  danger: true
})

export function resolveSessionMenuActions(context: SessionActionContext): ResolvedAction<SessionActionContext>[] {
  return sessionActionRegistry.resolve(context, 'menu')
}

export async function executeSessionMenuAction(
  action: ResolvedAction<SessionActionContext>,
  context: SessionActionContext
): Promise<boolean> {
  return sessionActionRegistry.execute(action.id, context)
}
