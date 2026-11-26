import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'

import { AgentSessionDeliveryService } from '../AgentSessionDeliveryService'
import { recoverSessionDeliveries } from '../recoverSessionDeliveries'

const dbh = setupTestDatabase()

beforeEach(() => {
  dbh.db
    .insert(agentTable)
    .values({ id: 'agent', type: 'pi-durable', name: 'Agent', instructions: '', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'work', type: 'user', name: 'Work', path: '/tmp', orderKey: 'a0' })
    .run()
  for (const id of ['sender', 'target'])
    dbh.db.insert(agentSessionTable).values({ id, agentId: 'agent', workspaceId: 'work', name: id, orderKey: id }).run()
})

/** A delivery interrupted before dispatch or before the native receipt reached Main. */
function interruptedDelivery(dispatched: boolean) {
  const branch = prepareDurableBranch('target')
  const context = contexts.bindContext(branch.id, '1')
  const request = messages.acceptSessionDelivery({
    senderAgentId: 'agent',
    senderSessionId: 'sender',
    receiverSessionId: 'target',
    content: 'Delivered work'
  })
  const reply = messages.saveMessage({
    sessionId: 'target',
    parentId: request.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [{ type: 'text', text: 'Partial' }] } }
  })
  messages.transitionSessionDelivery('target', request.id, 'delivering', { expected: ['accepted'], turnRef: reply.id })
  if (dispatched)
    application.get('DbService').withWriteTx((tx) => messages.bindInputContextTx(tx, 'target', request.id, context.id))
  return { request, reply, context }
}

// AC6: Durable still owns an admitted input after an exit, so boot recovery must not end its reply.
it('retains a dispatched Durable delivery across a lost acknowledgement and an agent change', () => {
  const { request, reply } = interruptedDelivery(true)
  dbh.db.update(agentTable).set({ type: 'pi' }).run()

  recoverSessionDeliveries()

  expect(messages.getSessionMessage('target', reply.id).status).toBe('pending')
  expect(messages.getSessionMessage('target', request.id).delivery?.status).toBe('delivering')
})

// Durable has no record of an input it never admitted; waiting for its outcome would hang the delivery.
it('ends a Durable delivery turn whose input never reached the runtime', () => {
  const { request, reply } = interruptedDelivery(false)

  recoverSessionDeliveries()

  expect(messages.getSessionMessage('target', reply.id).status).toBe('error')
  expect(messages.getSessionMessage('target', request.id).delivery?.status).not.toBe('delivering')
})

it('keeps the original delivery pending when its captured Durable target cannot reconnect', async () => {
  const { request, reply } = interruptedDelivery(true)
  const recoverPendingReplies = vi.fn(async () => {})
  dbh.db.update(agentTable).set({ type: 'pi' }).run()
  MockApplicationUtils.setService('AgentSessionRuntimeService', {
    onTurnTerminal: () => ({ dispose() {} }),
    onRuntimeIdle: () => ({ dispose() {} }),
    isSessionBusy: () => false,
    whenStartupRecoverySettles: async () => {},
    recoverPendingReplies
  })
  MockApplicationUtils.setService('AiStreamManager', {
    isWriteQuiesced: false,
    hasLiveStream: () => false,
    hasTerminalPersistenceInFlight: () => false
  })
  const service = new AgentSessionDeliveryService()
  onTestFinished(async () => {
    await service._doStop()
    MockApplicationUtils.resetServices()
  })

  await service._doInit()
  await service._doAllReady()

  await service.drainSessionQueues(['target'])
  expect(recoverPendingReplies).toHaveBeenCalledWith({
    sessionId: 'target',
    runId: reply.id,
    deliveryInputId: request.id
  })
  expect(messages.getSessionMessage('target', reply.id).status).toBe('pending')
  expect(messages.getSessionMessage('target', request.id).delivery?.status).toBe('delivering')
})
