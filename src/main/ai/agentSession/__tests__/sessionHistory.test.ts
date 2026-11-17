import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { buildAgentUserContent, withAgentContext } from '@main/ai/runtime/agentUserContent'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'
import type { CherryMessagePart } from '@shared/data/types/message'

import { prepareNativeSubmission } from '../nativeSubmission'
import { readSessionHistory } from '../sessionHistory'

const dbh = setupTestDatabase()
let head: string
let sibling: string
beforeEach(() => {
  dbh.db
    .insert(agentTable)
    .values({ id: 'agent', type: 'pi-durable', name: 'Agent', instructions: '', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'work', type: 'user', name: 'Work', path: '/test', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'session', agentId: 'agent', workspaceId: 'work', name: 'History', orderKey: 'a0' })
    .run()
  save('user', [{ type: 'text', text: 'Remember mango' }])
  const user = save('user', [{ type: 'text', text: 'Second question' }])
  head = save('assistant', [
    { type: 'reasoning', text: 'Historical reasoning step', state: 'done' },
    {
      type: 'dynamic-tool',
      toolCallId: randomUUID(),
      toolName: 'search',
      state: 'output-available',
      input: { queries: ['mango'] },
      output: { results: [], status: 'FINISHED' }
    },
    { type: 'text', text: 'Mango recorded' }
  ]).id
  sibling = randomUUID()
  dbh.db
    .insert(agentSessionMessageTable)
    .values({
      id: sibling,
      sessionId: 'session',
      parentId: user.id,
      role: 'assistant',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Sibling banana' }] }
    })
    .run()
})

function save(role: 'user' | 'assistant', parts: CherryMessagePart[]) {
  return messages.saveMessage({ sessionId: 'session', message: { role, status: 'success', data: { parts } } })
}

it('rebuilds the selected prefix without import metadata, preserving consecutive user messages and tool records', async () => {
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const context = await readSessionHistory('session', current.id)
  const content = buildAgentUserContent(current, context)
  expect(content.indexOf('Remember mango')).toBeLessThan(content.indexOf('Second question'))
  expect(content.indexOf('Second question')).toBeLessThan(content.indexOf('Mango recorded'))
  expect(content).toContain('"role":"user"')
  expect(content).toContain('"role":"assistant"')
  expect(content).toContain('"queries":["mango"]')
  expect(content).toContain('"results":[]')
  expect(content).toContain('Historical reasoning step')
  expect(content).not.toContain('Sibling banana')
  expect(content.endsWith('Continue')).toBe(true)
  expect(messages.getSessionMessage('session', current.id).data.parts).toEqual([{ type: 'text', text: 'Continue' }])
})

it('keeps history available after warming a fresh native identity and stops rebuilding after native input', async () => {
  const context = preparePiBranch('session', head)
  contexts.bindContext(context.id, context.nativeThreadId!)
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const history = await readSessionHistory('session', current.id)
  expect(history?.length).toBeGreaterThan(0)
  const draft = prepareNativeSubmission('session', current.id, context.id, 'reject', {
    text: buildAgentUserContent(current, history),
    parts: current.data.parts
  })
  expect(draft.text).toContain('Mango recorded')
  expect(messages.getSessionMessage('session', current.id).data.parts).toEqual([{ type: 'text', text: 'Continue' }])
  const next = save('user', [{ type: 'text', text: 'Follow up' }])
  expect(await readSessionHistory('session', next.id)).toBeUndefined()
})

it('retains attachment metadata through the existing runtime input conversion without changing product parts', async () => {
  const file: CherryMessagePart = {
    type: 'file',
    url: 'file:///managed/image.png',
    filename: 'original.png',
    mediaType: 'image/png'
  }
  save('user', [file])
  const current = save('user', [{ type: 'text', text: 'Describe that image' }])
  const context = await readSessionHistory('session', current.id)
  expect(withAgentContext(current, context).data.parts).toContainEqual(file)
  const text = buildAgentUserContent(current, context)
  expect(text).toContain('original.png')
  expect(text).toContain('/managed/image.png')
  expect(current.data.parts).toEqual([{ type: 'text', text: 'Describe that image' }])
})

it('preserves native recovery when existing product history has a resume token', async () => {
  dbh.db
    .update(agentSessionMessageTable)
    .set({ runtimeResumeToken: 'missing-native-store' })
    .where(eq(agentSessionMessageTable.id, head))
    .run()
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  expect(await readSessionHistory('session', current.id)).toBeUndefined()
})

it.each(['pi', 'pi-durable', 'claude-code'] as const)(
  'isolates unbound %s branches without changing their source messages or creating history checkpoints',
  (runtime) => {
    const prepare = (id: string) =>
      runtime === 'pi'
        ? preparePiBranch('session', id)
        : runtime === 'pi-durable'
          ? prepareDurableBranch('session', id)
          : prepareClaudeBranch('session', '/test/claude', undefined, id)
    const selected = prepare(head)
    const other = prepare(sibling)
    expect(selected.id).not.toBe(other.id)
    expect(selected.anchorMessageId).toBe(head)
    expect(other.anchorMessageId).toBe(sibling)
    expect(prepare(head).id).toBe(selected.id)
    expect(prepare(sibling).id).toBe(other.id)
    const historical = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .filter((row) => row.id === head || row.id === sibling)
    expect(historical.map((row) => row.data.runtimeAnchor)).toEqual([undefined, undefined])
  }
)
