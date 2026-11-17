import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, expect, it } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'

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

/** A delivery whose turn was running when the app exited; `admitted` means Durable recorded its input. */
function interruptedDelivery(admitted: boolean) {
  const context = preparePiBranch('target')
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
  application.get('DbService').withWriteTx((tx) => {
    messages.bindInputContextTx(tx, 'target', request.id, context.id)
    if (admitted) messages.bindNativeInputTx(tx, 'target', request.id, context.id, 'native-input')
  })
  return { request, reply }
}

// AC6: Durable still owns an admitted input after an exit, so boot recovery must not end its reply.
it('leaves an admitted Durable delivery turn for the runtime to resume', () => {
  const { request, reply } = interruptedDelivery(true)

  const { resumable } = recoverSessionDeliveries()

  expect(resumable).toEqual(new Set(['target']))
  expect(messages.getSessionMessage('target', reply.id).status).toBe('pending')
  expect(messages.getSessionMessage('target', request.id).delivery?.status).toBe('delivering')
})

// Durable has no record of an input it never admitted; waiting for its outcome would hang the delivery.
it('ends a Durable delivery turn whose input never reached the runtime', () => {
  const { request, reply } = interruptedDelivery(false)

  const { resumable } = recoverSessionDeliveries()

  expect(resumable.size).toBe(0)
  expect(messages.getSessionMessage('target', reply.id).status).toBe('error')
  expect(messages.getSessionMessage('target', request.id).delivery?.status).not.toBe('delivering')
})
