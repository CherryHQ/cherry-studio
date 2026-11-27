import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, expect, it, vi } from 'vitest'

import type { LookupInput } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'

import { lookupNativeInput, prepareNativeSubmission } from '../nativeSubmission'

const dbh = setupTestDatabase()
let sessionId: string

beforeEach(() => {
  sessionId = randomUUID()
  const workspaceId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Inputs', orderKey: 'a0' }).run()
})

it('preserves an interrupted input recovery target across same-anchor runtime takeover', async () => {
  const stale = preparePiBranch(sessionId)
  const input = messages.saveMessage({
    sessionId,
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'Interrupted input' }] } }
  })
  prepareNativeSubmission(sessionId, input.id, stale.id, 'reject')
  const original = { backendId: stale.backendId, nativeThreadId: stale.nativeThreadId! }

  const moved = prepareDurableBranch(sessionId)

  expect(moved.id).toBe(stale.id)
  expect(contexts.backend(moved.backendId).locator.kind).toBe('pi-durable')
  const binding = messages.inputBinding(sessionId, input.id)
  expect(binding?.contextId).toBeDefined()
  expect(binding?.contextId).not.toBe(stale.id)
  const recovery = contexts.context(binding!.contextId!)
  expect(recovery).toMatchObject({
    backendId: original.backendId,
    nativeThreadId: original.nativeThreadId,
    anchorMessageId: null
  })

  const lookupInput: LookupInput = vi.fn(async (_thread, inputId) => ({ inputId, facts: [] }))
  await lookupNativeInput(sessionId, binding!.contextId!, input.id, { backendId: original.backendId, lookupInput })

  expect(lookupInput).toHaveBeenCalledWith(
    { backendId: original.backendId, id: original.nativeThreadId },
    input.id,
    undefined
  )
})
