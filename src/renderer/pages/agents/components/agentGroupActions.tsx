import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { TFunction } from 'i18next'
import { Pin, PinOff, SquarePen, Trash2 } from 'lucide-react'

export interface AgentGroupActionContext {
  agentId: string
  deleteSessionsDisabled?: boolean
  onEdit: (agentId: string) => void
  onDeleteSessions: (agentId: string) => void | Promise<void>
  onTogglePin: (agentId: string) => void | Promise<void>
  pinDisabled?: boolean
  pinned: boolean
  t: TFunction
}

export type AgentGroupAction = ResolvedAction<AgentGroupActionContext>

const agentGroupActionRegistry = createActionRegistry<AgentGroupActionContext>()

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.edit',
  run: ({ agentId, onEdit }) => {
    window.requestAnimationFrame(() => onEdit(agentId))
  }
})

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.toggle-pin',
  availability: ({ pinDisabled }) => ({ enabled: !pinDisabled }),
  run: ({ agentId, onTogglePin }) => onTogglePin(agentId)
})

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.delete-sessions',
  availability: ({ deleteSessionsDisabled }) => ({ enabled: !deleteSessionsDisabled }),
  run: ({ agentId, onDeleteSessions }) => onDeleteSessions(agentId)
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.edit',
  commandId: 'agent-group.edit',
  label: ({ t }) => t('agent.edit.title'),
  icon: () => <SquarePen size={14} />,
  order: 10,
  surface: 'menu'
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.toggle-pin',
  commandId: 'agent-group.toggle-pin',
  label: ({ pinned, t }) => (pinned ? t('agent.unpin.title') : t('agent.pin.title')),
  icon: ({ pinned }) => (pinned ? <PinOff size={14} /> : <Pin size={14} />),
  order: 20,
  surface: 'menu'
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.delete-sessions',
  commandId: 'agent-group.delete-sessions',
  label: ({ t }) => t('agent.session.agent.delete.trigger'),
  icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
  group: 'danger',
  order: 30,
  surface: 'menu',
  danger: true
})

export function resolveAgentGroupActions(context: AgentGroupActionContext): AgentGroupAction[] {
  return agentGroupActionRegistry.resolve(context, 'menu')
}

export async function executeAgentGroupAction(
  action: AgentGroupAction,
  context: AgentGroupActionContext
): Promise<boolean> {
  return agentGroupActionRegistry.execute(action.id, context)
}
