import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { DeleteIcon, EditIcon, OpenInNewWindowIcon } from '@renderer/components/Icons'
import type { TFunction } from 'i18next'
import { ExternalLink, PinIcon, PinOffIcon } from 'lucide-react'

export interface SessionActionContext {
  isActiveInCurrentTab: boolean
  onDelete: () => void
  onOpenInNewTab?: () => void
  onOpenInNewWindow?: () => void
  onTogglePin?: () => void
  pinned?: boolean
  sessionName: string
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
  id: 'session.open-in-new-tab',
  availability: ({ isActiveInCurrentTab, onOpenInNewTab }) => ({
    visible: !!onOpenInNewTab && !isActiveInCurrentTab,
    enabled: !!onOpenInNewTab && !isActiveInCurrentTab
  }),
  run: ({ onOpenInNewTab }) => onOpenInNewTab?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.open-in-new-window',
  availability: ({ onOpenInNewWindow }) => ({
    visible: !!onOpenInNewWindow,
    enabled: !!onOpenInNewWindow
  }),
  run: ({ onOpenInNewWindow }) => onOpenInNewWindow?.()
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
  label: ({ pinned, t }) => (pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')),
  icon: ({ pinned }) => (pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
  order: 20,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.open-in-new-tab',
  commandId: 'session.open-in-new-tab',
  label: ({ t }) => t('common.open_in_new_tab'),
  icon: () => <ExternalLink size={14} />,
  order: 30,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.open-in-new-window',
  commandId: 'session.open-in-new-window',
  label: ({ t }) => t('tab.open_in_new_window'),
  icon: () => <OpenInNewWindowIcon size={14} />,
  order: 35,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.delete',
  commandId: 'session.delete',
  label: ({ t }) => t('common.delete'),
  icon: () => <DeleteIcon size={14} className="lucide-custom" />,
  group: 'danger',
  order: 40,
  surface: 'menu',
  danger: true,
  availability: ({ pinned }) => ({ visible: !pinned }),
  confirm: ({ t }) => ({
    title: t('agent.session.delete.title'),
    description: t('agent.session.delete.content'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    destructive: true
  })
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
