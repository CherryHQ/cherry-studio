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
import { replaceAgentSessionMessagePartsTx } from '@data/services/agentSessionMessageTree'
import { buildAgentUserContent, withAgentContext } from '@main/ai/runtime/agentUserContent'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'
import { MessageDataSchema, type CherryMessagePart } from '@shared/data/types/message'

import { applyNativeSubmissionResult, prepareNativeSubmission } from '../nativeSubmission'
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
      data: {}
    })
    .run()
  replaceAgentSessionMessagePartsTx(dbh.db, {
    sessionId: 'session',
    messageId: sibling,
    parts: [{ type: 'text', text: 'Sibling banana' }],
    timestampMs: Date.now()
  })
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
  expect(content).toContain('"output":{"results":[],"status":"FINISHED"}')
  expect(content).toContain('Historical reasoning step')
  expect(content).not.toContain('Sibling banana')
  expect(content.endsWith('Continue')).toBe(true)
  expect(messages.getSessionMessage('session', current.id).data.parts).toEqual([{ type: 'text', text: 'Continue' }])
})

it.each([
  {
    output: { exitCode: 0, path: '/tmp/report.md', resourceId: 'report-42' },
    expected: '"output":{"exitCode":0,"path":"/tmp/report.md","resourceId":"report-42"}'
  },
  { output: 'Created report-42', expected: '"output":"Created report-42"' },
  { output: 0, expected: '"output":0' },
  { output: false, expected: '"output":false' },
  { output: null, expected: '"output":null' }
])('preserves a short historical result unchanged: $expected', async ({ output, expected }) => {
  save('assistant', [
    { type: 'dynamic-tool', toolCallId: 'short-result', toolName: 'run', state: 'output-available', input: {}, output }
  ])
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const content = buildAgentUserContent(current, await readSessionHistory('session', current.id))
  expect(content).toContain(expected)
})

it('keeps bounded inline and persisted tool excerpts while preserving stored history', async () => {
  const parts: CherryMessagePart[] = [
    {
      type: 'dynamic-tool',
      toolCallId: 'search-call',
      toolName: 'search',
      state: 'output-available',
      input: { queries: ['historical query'] },
      output: {
        title: 'SEARCH_HEAD_FINDING',
        snippet: 'x'.repeat(10_000) + 'INLINE_MIDDLE_ONLY' + 'y'.repeat(10_000),
        url: 'https://example.test/search-tail'
      }
    },
    {
      type: 'tool-read_file',
      toolCallId: 'read-call',
      state: 'output-available',
      input: { path: 'notes.txt' },
      output: {
        $persistedToolOutput: {
          fileEntryId: randomUUID(),
          vfsFilename: 'stored-output.txt',
          head: 'STORED_OUTPUT_HEAD',
          tail: 'STORED_OUTPUT_TAIL',
          totalChars: 100_000,
          totalLines: 1000,
          shape: 'text'
        }
      }
    },
    {
      type: 'dynamic-tool',
      toolCallId: 'shell-output',
      toolName: 'shell',
      state: 'output-available',
      input: { command: 'generate report' },
      output:
        'SHELL_HEAD created report-42\n' +
        'x'.repeat(10_000) +
        'SHELL_MIDDLE_ONLY' +
        'y'.repeat(10_000) +
        '\nSHELL_TAIL exit code 0'
    },
    {
      type: 'dynamic-tool',
      toolCallId: 'failed-call',
      toolName: 'shell',
      state: 'output-error',
      input: { command: 'read missing-file' },
      errorText: 'File not found. ' + 'VERBOSE_ERROR_BODY'.repeat(1000)
    },
    { type: 'text', text: 'The answer already summarizes the useful findings.' }
  ]
  const original = save('assistant', parts)
  const current = save('user', [{ type: 'text', text: 'Continue from the findings' }])
  const content = buildAgentUserContent(current, await readSessionHistory('session', current.id))
  expect(content).toContain('"toolName":"search"')
  expect(content).toContain('"queries":["historical query"]')
  expect(content).toContain('"toolName":"read_file"')
  expect(content).toContain('"path":"notes.txt"')
  expect(content).toContain('"state":"output-error"')
  expect(content).toContain('File not found.')
  expect(content).toContain('The answer already summarizes the useful findings.')
  expect(content).toContain('SEARCH_HEAD_FINDING')
  expect(content).toContain('https://example.test/search-tail')
  expect(content).not.toContain('INLINE_MIDDLE_ONLY')
  expect(content).toContain('STORED_OUTPUT_HEAD')
  expect(content).toContain('STORED_OUTPUT_TAIL')
  expect(content).toContain('SHELL_HEAD created report-42')
  expect(content).toContain('SHELL_TAIL exit code 0')
  expect(content).not.toContain('SHELL_MIDDLE_ONLY')
  expect(content).toContain('Historical tool output truncated')
  expect(content).not.toContain('stored-output.txt')
  expect(content.length).toBeLessThan(5000)
  expect(messages.getSessionMessage('session', original.id).data.parts).toEqual(parts)
})

it('preserves persisted structured-result identities and excerpts without loading their blobs', async () => {
  const part: CherryMessagePart = {
    type: 'dynamic-tool',
    toolCallId: 'entities-call',
    toolName: 'read_resources',
    state: 'output-available',
    input: {},
    output: {
      $persistedToolOutput: {
        shape: 'entities',
        skeleton: [{ id: 'resource-42', path: '/tmp/resource.txt', content: 'PREVIEW_ONLY' }],
        blobRefs: [
          {
            key: '/0/content',
            fileEntryId: randomUUID(),
            vfsFilename: 'unavailable-blob.txt',
            head: 'ENTITY_HEAD',
            tail: 'ENTITY_TAIL',
            totalChars: 100_000,
            totalLines: 1000
          }
        ]
      }
    }
  }
  const historical = save('assistant', [part])
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const content = buildAgentUserContent(current, await readSessionHistory('session', current.id))
  expect(content).toContain('resource-42')
  expect(content).toContain('/tmp/resource.txt')
  expect(content).toContain('ENTITY_HEAD')
  expect(content).toContain('ENTITY_TAIL')
  expect(content).toContain('Historical tool output truncated')
  expect(content).not.toContain('unavailable-blob.txt')
  expect(content).not.toContain('PREVIEW_ONLY')
  expect(messages.getSessionMessage('session', historical.id).data.parts).toEqual([part])
})

it('reuses persisted text excerpts without cutting their line boundaries a second time', async () => {
  const head = 'h'.repeat(500)
  const tail = 'TAIL_FIRST_LINE\n' + 't'.repeat(970) + '\nTAIL_LAST_LINE'
  save('assistant', [
    {
      type: 'dynamic-tool',
      toolCallId: 'stored-lines',
      toolName: 'read',
      state: 'output-available',
      input: {},
      output: {
        $persistedToolOutput: {
          shape: 'text',
          fileEntryId: randomUUID(),
          vfsFilename: 'unavailable.txt',
          head,
          tail,
          totalChars: 100_000,
          totalLines: 1000
        }
      }
    }
  ])
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const content = buildAgentUserContent(current, await readSessionHistory('session', current.id))
  expect(content).toContain(head)
  expect(content).toContain('TAIL_FIRST_LINE')
  expect(content).toContain('TAIL_LAST_LINE')
  expect(content).toContain('Historical tool output truncated')
  expect(content).not.toContain('unavailable.txt')
})

it('keeps history available after warming a fresh native identity and stops rebuilding after native input', async () => {
  const context = preparePiBranch('session', head)
  contexts.bindContext(context.id, context.nativeThreadId!)
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const history = await readSessionHistory('session', current.id, context.id)
  expect(history?.length).toBeGreaterThan(0)
  const draft = prepareNativeSubmission('session', current.id, context.id, 'reject', {
    text: buildAgentUserContent(current, history),
    parts: current.data.parts
  })
  expect(draft.text).toContain('Mango recorded')
  expect(messages.getSessionMessage('session', current.id).data.parts).toEqual([{ type: 'text', text: 'Continue' }])
  const next = save('user', [{ type: 'text', text: 'Follow up' }])
  expect(await readSessionHistory('session', next.id, context.id)).toBeUndefined()
})

it('retains history across a local command whose reply owns the fresh context anchor and resume token', async () => {
  const local = save('user', [{ type: 'text', text: '/goal' }])
  const notice = save('assistant', [{ type: 'text', text: 'Local command notice' }])
  const context = prepareDurableBranch('session', notice.id)
  const draft = prepareNativeSubmission('session', local.id, context.id, 'reject')
  applyNativeSubmissionResult('session', context.id, {
    status: 'acknowledged',
    inputId: draft.inputId,
    facts: ['locally-handled']
  })
  messages.saveMessage({
    sessionId: 'session',
    message: { id: local.id, role: local.role, status: local.status, data: local.data }
  })
  expect(messages.getSessionMessage('session', local.id).data).not.toHaveProperty('locallyHandled')
  dbh.db
    .update(agentSessionMessageTable)
    .set({ runtimeResumeToken: 'local-native-root' })
    .where(eq(agentSessionMessageTable.id, notice.id))
    .run()
  const current = save('user', [{ type: 'text', text: 'Continue' }])
  const content = buildAgentUserContent(current, await readSessionHistory('session', current.id, context.id))
  expect(content).toContain('Mango recorded')
  expect(content).not.toContain('/goal')
  expect(content).not.toContain('Local command notice')
})

it('does not accept a caller-authored local-command marker as evidence of non-model input', async () => {
  const current = messages.saveMessage({
    sessionId: 'session',
    message: {
      role: 'user',
      status: 'success',
      data: MessageDataSchema.parse({ parts: [{ type: 'text', text: 'Real input' }], locallyHandled: true })
    }
  })
  const context = prepareDurableBranch('session', head)
  prepareNativeSubmission('session', current.id, context.id, 'reject')
  const next = save('user', [{ type: 'text', text: 'Follow up' }])
  expect(await readSessionHistory('session', next.id, context.id)).toBeUndefined()
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
