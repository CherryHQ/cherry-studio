import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { startup, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as sessionMessagesTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { savedChildView } from '@main/ai/agentSession/ChildThreadProjection'

import { fixture, spawnChild } from '../../../../../../packages/agent-runtime-claude-code/tests/nativeFixture'
import type { AgentRuntimeConnection, AgentRuntimeEvent } from '../../types'
import type * as AgentSessionWarmup from '../agentSessionWarmup'
import { ClaudeCodeRuntimeDriver } from '../ClaudeCodeRuntimeDriver'
import type { ClaudeCodeProcessDiagnostics } from '../processExitDiagnostics'
import type * as SettingsBuilder from '../settingsBuilder'

const ports = vi.hoisted(() => ({ build: vi.fn(), consume: vi.fn(), spawn: vi.fn() }))
vi.mock('../agentSessionWarmup', async (original) => ({
  ...(await original<typeof AgentSessionWarmup>()),
  buildClaudeCodeQueryRequestForAgentSession: ports.build
}))
vi.mock('../settingsBuilder', async (original) => ({
  ...(await original<typeof SettingsBuilder>()),
  registerMcpSessionCatalogSync: vi.fn()
}))

const dbh = setupTestDatabase()
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  MockApplicationUtils.resetServices()
  vi.clearAllMocks()
})

async function desktop(options: Parameters<typeof fixture>[0] = {}) {
  MockApplicationUtils.setService('ClaudeCodeWarmQueryManager', { consume: ports.consume })
  MockApplicationUtils.setService('ClaudeCodeProcessManager', { spawn: ports.spawn })
  MockApplicationUtils.setService('ClaudeCodeSessionStateService', { disposeToolPolicySnapshot: vi.fn() })
  const test = await fixture(options)
  cleanups.push(() => test.close())
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Native test', type: 'user', path: test.options.cwd, orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  ports.build.mockResolvedValue({
    key: sessionId,
    options: { ...test.options, env: { ...test.options.env, CLAUDE_CONFIG_DIR: test.configDir } },
    settings: {},
    sdkModelId: 'claude-sonnet-4-6',
    connectionConfig: {
      rebuildSignature: 'native-test',
      live: { toolPolicy: { permissionMode: null, disabledTools: [], mcps: [] } }
    },
    usageCapture: {
      owner: 'agent-sdk',
      providerId: 'native-test',
      credentialReceipt: { attribution: 'unknown' },
      source: null,
      frozenModels: []
    }
  })
  ports.consume.mockResolvedValue(undefined)
  ports.spawn.mockImplementation((options: SpawnOptions, diagnostics: ClaudeCodeProcessDiagnostics) => {
    const child = test.options.spawnClaudeCodeProcess!(options)
    diagnostics.exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    return child
  })
  let connection: AgentRuntimeConnection | undefined
  const events: AgentRuntimeEvent[] = []
  const input = (text: string) => ({
    message: messages.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
  })
  const connect = async () => {
    connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId,
      agentId: randomUUID(),
      modelId: 'native-test::claude-sonnet-4-6'
    })
    const current = connection
    const reading = (async () => {
      for await (const event of current.events) events.push(event)
    })()
    cleanups.push(async () => {
      await current.close()
      await reading
    })
    return current
  }
  const wait = async <T extends AgentRuntimeEvent['type']>(
    type: T,
    predicate: (event: Extract<AgentRuntimeEvent, { type: T }>) => boolean = () => true
  ) => {
    const find = () =>
      events.find(
        (event): event is Extract<AgentRuntimeEvent, { type: T }> =>
          event.type === type && predicate(event as Extract<AgentRuntimeEvent, { type: T }>)
      )
    await expect.poll(() => find() ?? events.find((event) => event.type === 'error'), { timeout: 15000 }).toBeDefined()
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    return find()!
  }
  return { ...test, sessionId, input, connect, events, wait }
}

// A native priority input must roll the host only when consumed; the child owns its own stored output.
it('joins native steer to the shared answer while keeping foreground child history independent', async () => {
  const test = await desktop()
  const first = test.input('Delegate to a child')
  const connection = await test.connect()
  await connection.send(first)
  const request = await test.request()
  request.reply.block(spawnChild('toolu_desktop'))
  request.reply.finish('tool_use')
  const child = await test.request()
  const second = test.input('Use the revised requirement')
  expect(connection.redirect!(second)).toBe(true)
  await expect
    .poll(() => messages.readSubmission(test.sessionId, second.message.id).submission.facts)
    .toContain('dispatch-started')
  child.reply.block({ type: 'text', text: 'Independent child answer' })
  child.reply.finish()
  const response = await test.request()
  expect(JSON.stringify(response.body.messages)).toContain('Use the revised requirement')
  response.reply.block({ type: 'text', text: 'Revised root answer' })
  response.reply.finish()
  const boundary = await test.wait('steer-boundary')
  expect(boundary.inputs.map((input) => input.message.id)).toEqual([second.message.id])
  await test.wait('turn-complete')
  const replies = test.events.filter((event) => event.type === 'input-response')
  expect(replies.map((event) => event.input.inputId)).toContain(first.message.id)
  expect(replies.map((event) => event.input.inputId)).toContain(second.message.id)
  expect(new Set(replies.map((event) => event.input.response?.id)).size).toBe(1)
  const context = contexts.findChild(test.sessionId, 'toolu_desktop')!
  expect(context).toBeDefined()
  await expect.poll(() => JSON.stringify(savedChildView(context).messages)).toContain('Independent child answer')
  expect(test.events.some((event) => event.type === 'background-flow-chunk')).toBe(false)
  const rootBodies = test.events
    .filter((event) => event.type === 'message-projection')
    .flatMap((event) => event.projection.messages)
  expect(
    rootBodies.filter((message) =>
      message.parts.some((part) => part.type === 'text' && part.text === 'Independent child answer')
    )
  ).toHaveLength(0)
  expect(test.events.filter((event) => event.type === 'error')).toEqual([])
}, 30000)

// Finishing before the steer is consumed must produce one subsequent native turn, not a host resend.
it('accepts steer across native completion and closes the actual subprocess', async () => {
  const test = await desktop()
  const first = test.input('First')
  const connection = await test.connect()
  await connection.send(first)
  const request = await test.request()
  request.reply.block({ type: 'text', text: 'First answer' })
  request.reply.finish()
  await test.wait('turn-complete')
  const second = test.input('Next')
  expect(connection.redirect!(second)).toBe(true)
  const next = await test.request()
  next.reply.block({ type: 'text', text: 'Second answer' })
  next.reply.finish()
  await expect.poll(() => test.events.filter((event) => event.type === 'turn-complete').length).toBe(2)
  expect(test.events.filter((event) => event.type === 'steer-boundary')).toHaveLength(1)
  await connection.closeForEdit!()
  expect(test.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true)
  expect(test.events.filter((event) => event.type === 'error')).toEqual([])
}, 30000)

// Background output must remain observable after the root result and survive closing/reopening its owner.
it('persists background child output independently and reopens the same child messages', async () => {
  const test = await desktop()
  const input = test.input('Start background work')
  const connection = await test.connect()
  await connection.send(input)
  const request = await test.request()
  request.reply.block(spawnChild('toolu_background_desktop', true))
  request.reply.finish('tool_use')
  const requests = [await test.request(), await test.request()]
  const parent = requests.find((value) => JSON.stringify(value.body.messages).includes('tool_result'))!
  const child = requests.find((value) => value !== parent)!
  parent.reply.block({ type: 'text', text: 'Parent done' })
  parent.reply.finish()
  await test.wait('turn-complete')
  child.reply.block({ type: 'text', text: 'Late child block one' })
  child.reply.block({ type: 'text', text: 'Late child block two' })
  child.reply.finish()
  const context = contexts.findChild(test.sessionId, 'toolu_background_desktop')!
  await expect.poll(() => JSON.stringify(savedChildView(context).messages)).toContain('Late child block two')
  const childResponses = test.events
    .filter((event) => event.type === 'response-start')
    .filter((event) => event.messageId)
  expect(new Set(childResponses.map((event) => event.responseId)).size).toBe(1)
  expect(new Set(childResponses.map((event) => event.messageId)).size).toBe(1)
  expect(
    test.events.every(
      (event) => event.type !== 'background-work-state' || !event.active || event.awaitingReply === false
    )
  ).toBe(true)
  await connection.close()
  const saved = savedChildView(contexts.context(context.id)).messages
  const replies = saved.filter((message) => message.role === 'assistant')
  expect(replies).toHaveLength(1)
  expect(replies[0].parts.filter((part) => part.type === 'text').map((part) => part.text)).toEqual([
    'Late child block one',
    'Late child block two'
  ])
  const reopened = await test.connect()
  await expect.poll(async () => Boolean(await reopened.childProjection!('toolu_background_desktop'))).toBe(true)
  const projection = await reopened.childProjection!('toolu_background_desktop')
  expect(projection!.snapshot().canSubmit).toBe(false)
  expect(projection!.snapshot().messages).toEqual(saved)
  expect(test.events.some((event) => event.type === 'background-flow-chunk')).toBe(false)
}, 30000)

// A warm subprocess must keep its actual serving credential and sole Query ownership after handoff.
it('adopts a real warm process with its captured credential receipt', async () => {
  const test = await desktop()
  const input = test.input('Use the warm process')
  const context = contexts.prepareClaudeBranch(test.sessionId, test.configDir)
  const warm = await startup({
    options: {
      ...test.options,
      sessionId: context.intendedThreadId!,
      env: { ...test.options.env, CLAUDE_CONFIG_DIR: test.configDir }
    }
  })
  const child = test.children[0]
  const receipt = { attribution: 'explicit', id: 'serving-key', masked: 'test-***' }
  ports.consume.mockResolvedValue({
    warmQuery: warm,
    processDiagnostics: {
      reference: 'warm-process',
      exited: new Promise<void>((resolve) => child.once('exit', () => resolve()))
    },
    usageCapture: {
      owner: 'agent-sdk',
      providerId: 'native-test',
      credentialReceipt: receipt,
      source: null,
      frozenModels: []
    }
  })
  const connection = await test.connect()
  await connection.send(input)
  const response = await test.request()
  response.reply.block({ type: 'text', text: 'Warm response' })
  response.reply.finish()
  await test.wait('turn-complete')
  expect(connection.usageCapture).toMatchObject({ owner: 'agent-sdk', credentialReceipt: receipt })
  expect(test.children).toHaveLength(1)
  await connection.closeForEdit!()
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
}, 30000)

// Nested output belongs to its immediate parent context, including after native archive recovery.
it('persists and restores nested children under their immediate parent', async () => {
  const test = await desktop({
    agents: {
      probe: { description: 'Nested child', prompt: 'Run the requested child', tools: ['Agent'], model: 'inherit' }
    }
  })
  const connection = await test.connect()
  await connection.send(test.input('Nested children'))
  const root = await test.request()
  root.reply.block(spawnChild('toolu_outer'))
  root.reply.finish('tool_use')
  const child = await test.request()
  child.reply.block(spawnChild('toolu_inner'))
  child.reply.finish('tool_use')
  const grandchild = await test.request()
  grandchild.reply.block({ type: 'text', text: 'Grandchild answer' })
  grandchild.reply.finish()
  const childResult = await test.request()
  childResult.reply.block({ type: 'text', text: 'Child answer' })
  childResult.reply.finish()
  const rootResult = await test.request()
  rootResult.reply.block({ type: 'text', text: 'Root answer' })
  rootResult.reply.finish()
  await test.wait('turn-complete')
  const outer = contexts.findChild(test.sessionId, 'toolu_outer')!
  const inner = contexts.findChild(test.sessionId, 'toolu_inner')!
  expect(inner.parentContextId).toBe(outer.id)
  await expect.poll(() => JSON.stringify(savedChildView(inner).messages)).toContain('Grandchild answer')
  expect(
    savedChildView(outer).messages.flatMap((message) => message.parts.filter((part) => part.type === 'text'))
  ).not.toContainEqual(expect.objectContaining({ text: 'Grandchild answer' }))
  await connection.close()
  const saved = savedChildView(inner).messages
  const reopened = await test.connect()
  await expect.poll(async () => Boolean(await reopened.childProjection!('toolu_inner'))).toBe(true)
  expect((await reopened.childProjection!('toolu_inner'))!.snapshot().messages).toEqual(saved)
}, 30000)

// Stopping one native task must not close the Query owner or interrupt a sibling's projection.
it('stops one background child while its sibling persists its answer', async () => {
  const test = await desktop()
  const connection = await test.connect()
  await connection.send(test.input('Two background children'))
  const root = await test.request()
  root.reply.block(spawnChild('toolu_stop', true))
  root.reply.block(spawnChild('toolu_keep', true))
  root.reply.finish('tool_use')
  const requests = [await test.request(), await test.request(), await test.request()]
  const parent = requests.find((request) => JSON.stringify(request.body.messages).includes('tool_result'))!
  const stopped = requests.find(
    (request) => request !== parent && JSON.stringify(request.body.messages).includes('Child toolu_stop')
  )!
  const kept = requests.find((request) => request !== parent && request !== stopped)!
  parent.reply.block({ type: 'text', text: 'Parent done' })
  parent.reply.finish()
  await test.wait('turn-complete')
  await expect.poll(() => contexts.findChild(test.sessionId, 'toolu_stop')?.subagentId).toBeDefined()
  const task = contexts.findChild(test.sessionId, 'toolu_stop')!.subagentId!
  expect(await connection.stopTask!(task)).toBe(true)
  await stopped.reply.closed
  kept.reply.block({ type: 'text', text: 'Sibling survived' })
  kept.reply.finish()
  const context = contexts.findChild(test.sessionId, 'toolu_keep')!
  await expect.poll(() => JSON.stringify(savedChildView(context).messages)).toContain('Sibling survived')
  expect(test.events.filter((event) => event.type === 'error')).toEqual([])
}, 30000)

// A native reset must select a fresh context without losing the old saved root identity.
it('binds the native session after clear and keeps the previous context', async () => {
  const test = await desktop()
  const connection = await test.connect()
  await connection.send(test.input('Before clear'))
  const first = await test.request()
  first.reply.block({ type: 'text', text: 'Original answer' })
  first.reply.finish()
  await test.wait('turn-complete')
  const original = test.events.find((event) => event.type === 'message-projection')!
  if (original.type !== 'message-projection') throw new Error('Missing initial context')
  const context = contexts.context(original.projection.contextId)
  await connection.send(test.input('/clear'))
  await expect.poll(() => test.events.filter((event) => event.type === 'turn-complete').length).toBe(2)
  await connection.send(test.input('After clear'))
  const next = await test.request()
  expect(JSON.stringify(next.body.messages)).not.toContain('Before clear')
  next.reply.block({ type: 'text', text: 'New answer' })
  next.reply.finish()
  await expect.poll(() => test.events.filter((event) => event.type === 'turn-complete').length).toBe(3)
  const latest = test.events.findLast((event) => event.type === 'message-projection')!
  if (latest.type !== 'message-projection') throw new Error('Missing new context')
  expect(latest.projection.contextId).not.toBe(context.id)
  expect(contexts.context(context.id).nativeThreadId).toBe(context.nativeThreadId)
  expect(contexts.context(latest.projection.contextId).nativeThreadId).not.toBe(context.nativeThreadId)
}, 30000)

// Switching input ownership to the package must retain native images and tool-readable attachment paths.
it('submits native image blocks and local document paths through the common owner', async () => {
  const test = await desktop()
  const attachment = `${test.options.cwd}/details.txt`
  await writeFile(attachment, 'Local attachment')
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII='
  const input = {
    message: messages.saveMessage({
      sessionId: test.sessionId,
      message: {
        role: 'user',
        status: 'success',
        data: {
          parts: [
            { type: 'text', text: 'Inspect these attachments' },
            { type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${image}` },
            { type: 'file', mediaType: 'text/plain', filename: 'details.txt', url: pathToFileURL(attachment).href }
          ]
        }
      }
    })
  }
  const connection = await test.connect()
  await connection.send(input)
  const request = await test.request()
  const sent = JSON.stringify(request.body.messages)
  expect(sent).toContain(attachment)
  expect(sent).toContain(image)
  expect(sent).toContain('Inspect these attachments')
  request.reply.block({ type: 'text', text: 'Attachments received' })
  request.reply.finish()
  await test.wait('turn-complete')
  const saved = dbh.db.select().from(sessionMessagesTable).where(eq(sessionMessagesTable.id, input.message.id)).get()
  expect(saved?.submission?.outcome).toBe('completed')
}, 30000)
