import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { terminalConversationId, terminalGeneration, terminalResourceId } from '@main/services/terminal/contracts'
import type { TerminalResourceRef } from '@main/services/terminal/TerminalService'
import type { terminalRequestSchemas } from '@shared/ipc/schemas/terminal'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

const service = () => application.get('TerminalService')
function owner(senderId: WindowId | null): WindowId {
  if (!senderId || !application.get('WindowManager').getWindow(senderId))
    throw new Error('Terminal requires an app window')
  return senderId
}
function resourceRef(input: { host: { conversationId: string; generation: string }; id: string }): TerminalResourceRef {
  agentSessionService.getById(input.host.conversationId)
  return {
    host: {
      conversationId: terminalConversationId.parse(input.host.conversationId),
      generation: terminalGeneration.parse(input.host.generation)
    },
    id: terminalResourceId.parse(input.id)
  }
}

export const terminalHandlers: IpcHandlersFor<typeof terminalRequestSchemas> = {
  'terminal.cleanup.status': async (_input, { senderId }) => {
    owner(senderId)
    return application.get('AgentWorkspaceStorageService').cleanupStatus()
  },
  'terminal.cleanup.list': async (_input, { senderId }) => {
    owner(senderId)
    return application.get('AgentWorkspaceStorageService').listUnconfirmedUsage()
  },
  'terminal.cleanup.retry': async ({ id }, { senderId }) => {
    owner(senderId)
    return application.get('AgentLifecycleService').retryWorkspaceCleanup(id)
  },
  'terminal.list': async ({ sessionId, selectedId }, { senderId }) => {
    owner(senderId)
    agentSessionService.getById(sessionId)
    return service().listForView(terminalConversationId.parse(sessionId), selectedId)
  },
  'terminal.create': async ({ sessionId, shell, operationId }, { senderId }) => {
    owner(senderId)
    return application.get('AgentLifecycleService').createUserTerminal({ sessionId, shell, operationId })
  },
  'terminal.read': async ({ ref, cursor }, { senderId }) => {
    owner(senderId)
    return service().readText(resourceRef(ref), cursor)
  },
  'terminal.attach': async (ref, { senderId }) => service().openView(resourceRef(ref), owner(senderId)),
  'terminal.frame': async ({ viewId, rowStart, offset, revision, theme, layout }, { senderId }) =>
    service().viewFrame(viewId, owner(senderId), rowStart, offset, revision, theme, layout),
  'terminal.blocks.list': async ({ viewId, ...input }, { senderId }) =>
    service().listBlocks(viewId, owner(senderId), input),
  'terminal.blocks.read': async ({ viewId, ...input }, { senderId }) =>
    service().readBlock(viewId, owner(senderId), input),
  'terminal.search.set': async ({ viewId, ...input }, { senderId }) =>
    service().setSearch(viewId, owner(senderId), input),
  'terminal.search.navigate': async ({ viewId, ...input }, { senderId }) =>
    service().navigateSearch(viewId, owner(senderId), input),
  'terminal.search.close': async ({ viewId, queryRevision }, { senderId }) =>
    service().closeSearch(viewId, owner(senderId), queryRevision),
  'terminal.detach': async ({ viewId }, { senderId }) => service().closeView(viewId, owner(senderId)),
  'terminal.link': async ({ viewId, ...input }, { senderId }) => service().viewLink(viewId, owner(senderId), input),
  'terminal.action': async ({ viewId, operationId, controlRevision, action }, { senderId }) =>
    service().userAction(viewId, owner(senderId), operationId, controlRevision, action),
  'terminal.promote': async ({ ref, operationId, cancelRevision }, { senderId }) => {
    owner(senderId)
    const target = resourceRef(ref)
    const state = service()
      .list(target.host.conversationId)
      .find((item) => item.id === target.id)
    if (!state) throw new Error('Unknown terminal execution')
    return service().mutate(
      target,
      { kind: 'promote', id: target.id, context: state.context, cancelRevision },
      operationId
    )
  },
  'terminal.stop': async ({ ref, operationId, controlRevision, cancelRevision }, { senderId }) => {
    owner(senderId)
    const target = resourceRef(ref)
    return service().mutate(
      target,
      { kind: 'stop', id: target.id, actor: { kind: 'user' }, controlRevision, cancelRevision, reason: 'user' },
      operationId
    )
  }
}
