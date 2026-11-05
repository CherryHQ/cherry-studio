import { randomUUID } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { startup, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'

import { runtimeId, type InputState } from '@cherrystudio/agent-runtime'
import type { ClaudeThreadHandle } from '@cherrystudio/agent-runtime-claude-code'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable as sessionMessagesTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { ChildThreadProjection, savedChildView } from '@main/ai/agentSession/ChildThreadProjection'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'
import { prepareClaudeBranch, reserveClaudeBranchTx } from '@main/ai/runtime/claudeCode/claudeContext'

import { ClaudeFeed } from '../../../../../../packages/agent-runtime-claude-code/src/observation'
import { fixture, spawnChild } from '../../../../../../packages/agent-runtime-claude-code/tests/nativeFixture'
import { assistantMessage, wireProcess } from '../../../../../../packages/agent-runtime-claude-code/tests/wireFixture'
import type { AgentRuntimeConnection, AgentRuntimeEvent } from '../../types'
import type * as AgentSessionWarmup from '../agentSessionWarmup'
import { ClaudeCodeRuntimeDriver } from '../ClaudeCodeRuntimeDriver'
import type { ClaudeCodeProcessDiagnostics } from '../processExitDiagnostics'
import type * as SettingsBuilder from '../settingsBuilder'

vi.mock(
  '@cherrystudio/agent-runtime-claude-code',
  () => import('../../../../../../packages/agent-runtime-claude-code/src')
)

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
const sessionContexts = (sessionId: string) =>
  dbh.db.select().from(agentSessionContextTable).where(eq(agentSessionContextTable.sessionId, sessionId)).all()
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
  const nativeInputs: InputState[] = []
  const input = (text: string) => ({
    message: messages.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
  })
  const connect = async (nativeSessionId?: string, branchHead?: string) => {
    connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId,
      agentId: randomUUID(),
      modelId: 'native-test::claude-sonnet-4-6',
      nativeSessionId,
      branchHead
    })
    const current = connection
    const handle = (current as unknown as { handle: ClaudeThreadHandle }).handle
    await handle.observe((event) => {
      if (event.type === 'snapshot') nativeInputs.push(...event.inputs)
      if (event.type === 'input.changed') nativeInputs.push(event.input)
    })
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
  return { ...test, sessionId, input, connect, events, wait, nativeInputs }
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
    .poll(() =>
      test.nativeInputs.some((state) => state.inputId === second.message.id && state.facts.includes('dispatch-started'))
    )
    .toBe(true)
  child.reply.block({ type: 'text', text: 'Independent child answer' })
  child.reply.finish()
  const response = await test.request()
  expect(JSON.stringify(response.body.messages)).toContain('Use the revised requirement')
  response.reply.block({ type: 'text', text: 'Revised root answer' })
  response.reply.finish()
  const boundary = await test.wait('steer-boundary')
  expect(boundary.inputIds).toEqual([second.message.id])
  await test.wait('turn-complete')
  const replies = [
    ...new Map(test.nativeInputs.filter((state) => state.response).map((state) => [state.inputId, state])).values()
  ]
  expect(replies.map((state) => state.inputId)).toEqual(expect.arrayContaining([first.message.id, second.message.id]))
  expect(new Set(replies.map((state) => state.response?.id)).size).toBe(1)
  const context = contexts.findChild(test.sessionId, 'toolu_desktop')!
  expect(context).toBeDefined()
  await expect.poll(() => JSON.stringify(savedChildView(context).messages)).toContain('Independent child answer')

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

// Backup and close must join blocked child observation before final persistence and retain saved history.
it.each(['backup', 'close'] as const)(
  'drains blocked background child output for %s and reopens history',
  async (mode) => {
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
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = false
    const accept = ThreadMessageProjection.prototype.accept
    const observer = vi.spyOn(ThreadMessageProjection.prototype, 'accept').mockImplementation(async function (
      this: ThreadMessageProjection,
      ...args
    ) {
      if (!entered && JSON.stringify(args).includes('Late child block two')) {
        entered = true
        await blocked
      }
      return accept.apply(this, args)
    })
    let drained = false
    const draining = connection.drainChildWrites!().then(() => {
      drained = true
    })
    let closed = false
    let closing: Promise<void> | undefined
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      child.reply.block({ type: 'text', text: 'Late child block one' })
      child.reply.block({ type: 'text', text: 'Late child block two' })
      child.reply.finish()
      const notification = await test.request()
      notification.reply.block({ type: 'text', text: 'Child completion received' })
      notification.reply.finish()
      await expect.poll(() => entered).toBe(true)
      if (mode === 'close') {
        closing = Promise.resolve(connection.close()).then(() => {
          closed = true
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      expect(closed).toBe(false)
    } finally {
      release()
      observer.mockRestore()
    }
    await Promise.all([closing, draining])
    if (mode === 'backup')
      expect(test.children.some((child) => child.exitCode === null && child.signalCode === null)).toBe(true)
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
    const saved = savedChildView(contexts.context(context.id)).messages
    const replies = saved.filter((message) => message.role === 'assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0].parts.filter((part) => part.type === 'text').map((part) => part.text)).toEqual([
      'Late child block one',
      'Late child block two'
    ])
    const changes = dbh.sqlite.prepare('SELECT total_changes() AS count').get()
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(dbh.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
    await connection.close()
    const reopened = await test.connect()
    await expect.poll(async () => Boolean(await reopened.childProjection!('toolu_background_desktop'))).toBe(true)
    const projection = await reopened.childProjection!('toolu_background_desktop')
    expect(projection!.snapshot().canSubmit).toBe(false)
    expect(projection!.snapshot().messages).toEqual(saved)
  },
  30000
)

// A warm subprocess must keep its actual serving credential and sole Query ownership after handoff.
it('adopts a real warm process with its captured credential receipt', async () => {
  const test = await desktop()
  const input = test.input('Use the warm process')
  const context = prepareClaudeBranch(test.sessionId, test.configDir)
  const warm = await startup({
    options: {
      ...test.options,
      sessionId: context.nativeThreadId!,
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

// A failed cold attach must retry the saved child binding even when the root has no direct creation evidence.
it('restores nested children under their immediate parent after an attachment failure', async () => {
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
  let failed = false
  const originalAttach = ChildThreadProjection.prototype.attach
  const attach = vi
    .spyOn(ChildThreadProjection.prototype, 'attach')
    .mockImplementation(function (this: ChildThreadProjection) {
      if (!failed && this.context.id === inner.id) {
        failed = true
        return Promise.reject(new Error('Child attachment temporarily unavailable'))
      }
      return originalAttach.call(this)
    })
  try {
    const reopened = await test.connect()
    await expect.poll(() => failed).toBe(true)
    expect(savedChildView(contexts.context(inner.id)).messages).toEqual(saved)
    const projections = await Promise.all([
      reopened.childProjection!('toolu_inner'),
      reopened.childProjection!('toolu_inner')
    ])
    for (const projection of projections) expect(projection?.snapshot().messages).toEqual(saved)
    expect(contexts.children(outer.id).filter((context) => context.spawnToolCallId === 'toolu_inner')).toHaveLength(1)
  } finally {
    attach.mockRestore()
  }
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
  const { tasks } = await test.wait('background-tasks', (event) =>
    event.tasks.some((task) => task.toolCallId === 'toolu_stop')
  )
  const task = tasks.find((task) => task.toolCallId === 'toolu_stop')!
  expect(await connection.stopTask!(task.id)).toBe(true)
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

it.each(['managed', 'external', 'failure'])(
  'dispatches real %s image bytes through the native owner',
  async (kind) => {
    const test = await desktop()
    const bytes = await sharp({ create: { width: 1000, height: 4, channels: 3, background: '#123456' } })
      .png()
      .toBuffer()
    MockApplicationUtils.setService('FileManager', {
      getPhysicalPath: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue({ ext: 'png' }),
      read: vi.fn().mockResolvedValue({ content: bytes.toString('base64'), mime: 'image/png' })
    })
    const input = {
      message: messages.saveMessage({
        sessionId: test.sessionId,
        message: {
          role: 'user',
          status: 'success',
          data: {
            parts: [
              { type: 'text', text: 'Describe this image' },
              kind === 'managed'
                ? {
                    type: 'file',
                    url: '',
                    mediaType: 'image/png',
                    filename: 'strip.png',
                    providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
                  }
                : {
                    type: 'file',
                    url: `data:image/png;base64,${bytes.toString('base64')}`,
                    mediaType: 'application/octet-stream',
                    filename: 'strip.png'
                  }
            ]
          }
        }
      })
    }
    const connection = await test.connect()
    const extend =
      kind === 'failure'
        ? vi.spyOn(sharp.prototype, 'extend').mockImplementationOnce(() => {
            throw new Error('encoder failed')
          })
        : undefined
    try {
      await connection.send(input)
    } finally {
      extend?.mockRestore()
    }
    const request = await test.request()
    const image = request.body.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === 'image')
    expect(image?.source.type).toBe('base64')
    if (!image || image.source.type !== 'base64') throw new Error('Missing inline image')
    expect(image.source.media_type).toBe('image/png')
    const sent = Buffer.from(image.source.data, 'base64')
    expect(await sharp(sent).metadata()).toMatchObject({ width: 1000, height: kind === 'failure' ? 4 : 15 })
    if (kind === 'failure') {
      expect(sent).toEqual(bytes)
      expect(JSON.stringify(request.body.messages)).not.toContain('could not read')
    }
    request.reply.block({ type: 'text', text: 'Image received' })
    request.reply.finish()
    await test.wait('turn-complete')
  },
  30000
)

// Switching input ownership to the package must retain native images and tool-readable attachment paths.
it('submits native image blocks and local document paths through the common owner', async () => {
  const test = await desktop()
  const attachment = `${test.options.cwd}/details.txt`
  await writeFile(attachment, 'Local attachment')
  const image = (
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#123456' } })
      .png()
      .toBuffer()
  ).toString('base64')
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
  expect(saved).toMatchObject({ inputContextId: expect.any(String), nativeInputId: expect.any(String) })
  expect(test.nativeInputs.some((state) => state.inputId === input.message.id && state.outcome === 'completed')).toBe(
    true
  )
}, 30000)

it.each(['rejected', 'unsupported', 'unknown'] as const)(
  'retains only uncertain Claude input bindings after %s',
  async (status) => {
    const test = await desktop()
    const connection = await test.connect()
    const user = test.input('not accepted')
    const handle = (connection as unknown as { handle: ClaudeThreadHandle }).handle
    vi.spyOn(handle.claude, 'submit').mockResolvedValue({
      status,
      inputId: runtimeId(user.message.id),
      error: { operation: 'submit', code: 'fixture', message: status }
    })
    await expect(connection.send(user)).rejects.toThrow(status)
    if (status === 'unknown') {
      expect(messages.inputBinding(test.sessionId, user.message.id)?.contextId).toBeDefined()
      expect(() => messages.deleteSessionMessage(test.sessionId, user.message.id)).toThrow('native input binding')
    } else {
      expect(messages.inputBinding(test.sessionId, user.message.id)).toBeUndefined()
      messages.updateSessionMessage(test.sessionId, user.message.id, {
        data: { parts: [{ type: 'text', text: 'corrected' }] }
      })
      messages.deleteSessionMessage(test.sessionId, user.message.id)
      expect(() => messages.getSessionMessage(test.sessionId, user.message.id)).toThrow()
    }
  },
  30000
)

// Editing the first user turn reserves a new native identity, without creating an archive to resume.
it('creates a reserved empty Claude branch and reopens it after its first answer', async () => {
  const test = await desktop()
  const original = prepareClaudeBranch(test.sessionId, test.configDir)
  contexts.bindContext(original.id, original.nativeThreadId!)
  const edited = test.input('Edited first request')
  const nativeId = randomUUID()
  dbh.db.transaction((tx) => {
    reserveClaudeBranchTx(tx, test.sessionId, edited.message.id, nativeId)
    messages.setEditRuntimeTx(tx, test.sessionId, edited.message.id, nativeId)
  })
  const request = await ports.build()
  ports.build.mockImplementation(async (_sessionId: string, resume?: string | null) => ({
    ...request,
    options: { ...request.options, resume: resume ?? undefined }
  }))
  const connection = await test.connect(nativeId, edited.message.id)
  await connection.send(edited)
  const response = await test.request()
  response.reply.block({ type: 'text', text: 'Edited branch answer' })
  response.reply.finish()
  await test.wait('turn-complete')
  await connection.closeForEdit!()
  expect(messages.getLastRuntimeResumeToken(test.sessionId, edited.message.id)).toBe(nativeId)
  const selected = prepareClaudeBranch(test.sessionId, test.configDir)
  expect(selected).toMatchObject({ nativeThreadId: nativeId, bindingState: 'bound' })
  expect(contexts.context(original.id).nativeThreadId).toBe(original.nativeThreadId)
  test.events.length = 0
  const reopened = await test.connect(nativeId, edited.message.id)
  await reopened.send(test.input('Continue edited branch'))
  const continuation = await test.request()
  expect(JSON.stringify(continuation.body.messages)).toContain('Edited branch answer')
  continuation.reply.block({ type: 'text', text: 'Restored edited branch' })
  continuation.reply.finish()
  await test.wait('turn-complete')
}, 30000)

// A slow desktop observer must settle from a recovered baseline after the bounded feed folds its result.
it('recovers current content and one terminal result after observer overflow, then accepts another input', async () => {
  const test = await desktop()
  const connection = await test.connect()
  const observed: { feed?: ClaudeFeed } = {}
  const publish = ClaudeFeed.prototype.publish
  const feedSpy = vi.spyOn(ClaudeFeed.prototype, 'publish').mockImplementation(function (
    this: ClaudeFeed,
    events,
    native,
    ...rest
  ) {
    if (native?.some((entry) => entry.source === 'live' && entry.message.type === 'assistant')) observed.feed = this
    return publish.call(this, events, native, ...rest)
  })
  const original = ThreadMessageProjection.prototype.accept
  const paused = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  let held = false
  const spy = vi
    .spyOn(ThreadMessageProjection.prototype, 'accept')
    .mockImplementation(async function (this: ThreadMessageProjection, event, refresh) {
      const events = 'type' in event ? [event] : event
      if (!held && events.some((item) => item.type === 'message.upsert' && item.message.role === 'assistant')) {
        held = true
        paused.resolve()
        await resume.promise
      }
      return original.call(this, event, refresh)
    })
  try {
    const first = test.input('Produce many blocks')
    await connection.send(first)
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'First block' })
    await paused.promise
    for (let index = 0; index < 130; index++) request.reply.block({ type: 'text', text: `Block ${index}. ` })
    request.reply.block({ type: 'text', text: 'Final recovered answer' })
    request.reply.finish()
    await expect
      .poll(
        () => test.nativeInputs.some((input) => input.inputId === first.message.id && input.outcome === 'completed'),
        { timeout: 15000 }
      )
      .toBe(true)
    // More lifecycle updates can arrive after the result while this observer is still blocked.
    for (let index = 0; index < 101; index++)
      observed.feed!.publish([{ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } }])
    resume.resolve()
    await test.wait('turn-complete')
    const projections = test.events.flatMap((event) => (event.type === 'message-projection' ? [event.projection] : []))
    expect(
      projections.some((view) =>
        view.messages.some(
          (message) =>
            view.live.includes(message.id) &&
            message.parts.some((part) => part.type === 'text' && part.text.includes('Final recovered answer'))
        )
      )
    ).toBe(true)
    expect(test.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    test.events.length = 0
    await connection.send(test.input('Next input'))
    const next = await test.request()
    next.reply.block({ type: 'text', text: 'Next answer' })
    next.reply.finish()
    await test.wait('turn-complete')
    expect(test.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
  } finally {
    resume.resolve()
    spy.mockRestore()
    feedSpy.mockRestore()
  }
}, 60000)

// Committed sources use bare UUIDs; historical content cannot satisfy the current turn's salvage threshold.
it.each(['current-answer', 'history-only', 'user-only'])(
  'salvages only current assistant output after native JSON truncation (%s)',
  async (source) => {
    const historyOnly = source === 'history-only'
    const wire = wireProcess()
    const test = await desktop({ spawnClaudeCodeProcess: () => wire.process })
    const connection = await test.connect()
    const context = sessionContexts(test.sessionId).find((context) => context.nativeThreadId)!
    if (historyOnly) {
      await connection.send(test.input('Previous input'))
      await expect.poll(() => wire.inputs.length).toBe(1)
      wire.send(
        assistantMessage(
          context.nativeThreadId!,
          [{ type: 'text', text: 'Historical answer'.repeat(60), citations: null }],
          { user_message_uuid: wire.inputs[0].uuid }
        )
      )
      wire.send({
        type: 'result',
        subtype: 'success',
        uuid: randomUUID(),
        session_id: context.nativeThreadId!,
        user_message_uuid: wire.inputs[0].uuid,
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: '',
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          iterations: [],
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          service_tier: 'standard',
          inference_geo: 'us',
          speed: 'standard'
        },
        modelUsage: {},
        permission_denials: []
      })
      await test.wait('turn-complete')
      test.events.length = 0
    }
    await connection.send(test.input(source === 'user-only' ? 'Current user prompt'.repeat(60) : 'Current input'))
    await expect.poll(() => wire.inputs.length).toBe(historyOnly ? 2 : 1)
    const current = assistantMessage(
      context.nativeThreadId!,
      [
        {
          type: 'text',
          text: source === 'current-answer' ? 'Current answer'.repeat(60) : 'Short current answer',
          citations: null
        }
      ],
      { user_message_uuid: wire.inputs.at(-1)!.uuid }
    )
    if (source === 'user-only') {
      const user = { ...wire.inputs.at(-1)!, session_id: context.nativeThreadId!, parent_tool_use_id: null }
      wire.send(user)
      await test.wait('message-projection', (event) => event.projection.live.includes(user.uuid!))
    }
    wire.send(current)
    await test.wait('message-projection', (event) => event.projection.live.includes(current.uuid))
    const archiveDir = path.join(
      test.configDir,
      'projects',
      (await realpath(test.options.cwd)).replace(/[^a-zA-Z0-9]/g, '-')
    )
    await mkdir(archiveDir, { recursive: true })
    await writeFile(
      path.join(archiveDir, `${context.nativeThreadId}.jsonl`),
      [...wire.inputs, current]
        .map((entry, index, entries) =>
          JSON.stringify({
            ...entry,
            isSidechain: false,
            sessionId: context.nativeThreadId,
            cwd: test.options.cwd,
            parentUuid: entries[index - 1]?.uuid ?? null,
            timestamp: new Date().toISOString()
          })
        )
        .join('\n') + '\n'
    )
    wire.fail(new SyntaxError('Unexpected end of JSON input'))
    await expect
      .poll(() => test.events.some((event) => event.type === 'turn-complete' || event.type === 'error'), {
        timeout: 15000
      })
      .toBe(true)
    if (source !== 'current-answer') expect(test.events.filter((event) => event.type === 'error')).toHaveLength(1)
    else expect(test.events.filter((event) => event.type === 'error')).toEqual([])
    expect(test.events.filter((event) => event.type === 'turn-complete')).toHaveLength(
      source === 'current-answer' ? 1 : 0
    )
    wire.exit()
  },
  30000
)

it('maps native SDK usage to product token totals once per response', async () => {
  const wire = wireProcess()
  const test = await desktop({ spawnClaudeCodeProcess: () => wire.process })
  const connection = await test.connect()
  await connection.send(test.input('Report usage'))
  await expect.poll(() => wire.inputs.length).toBe(1)
  const context = sessionContexts(test.sessionId).find((context) => context.nativeThreadId)!
  const assistant = assistantMessage(context.nativeThreadId!, [{ type: 'text', text: 'Done', citations: null }])
  assistant.message.usage = {
    ...assistant.message.usage,
    input_tokens: 13,
    cache_read_input_tokens: 19,
    cache_creation_input_tokens: 17,
    output_tokens: 23
  }
  wire.send(assistant)
  wire.send({
    type: 'stream_event',
    uuid: randomUUID(),
    session_id: context.nativeThreadId!,
    parent_tool_use_id: null,
    event: { type: 'message_stop' }
  })
  await test.wait('usage')
  wire.send(assistant)
  wire.exit()
  await connection.close()
  expect(test.events.filter((event) => event.type === 'usage')).toMatchObject([
    {
      invocation: {
        requestId: `claude-agent:${assistant.message.id}`,
        responseId: assistant.message.id,
        model: assistant.message.model,
        usage: {
          inputTokens: 49,
          outputTokens: 23,
          totalTokens: 72,
          noCacheTokens: 13,
          cacheReadTokens: 19,
          cacheWriteTokens: 17
        }
      }
    }
  ])
})

it('publishes the native resume identity before a failed first result', async () => {
  const wire = wireProcess()
  const test = await desktop({ spawnClaudeCodeProcess: () => wire.process })
  const connection = await test.connect()
  const context = sessionContexts(test.sessionId).find((context) => context.nativeThreadId)!
  await connection.send(test.input('First input fails'))
  await expect.poll(() => wire.inputs.length).toBe(1)
  wire.send({
    type: 'result',
    subtype: 'error_during_execution',
    uuid: randomUUID(),
    session_id: context.nativeThreadId!,
    user_message_uuid: wire.inputs[0].uuid,
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    errors: ['Native failure'],
    modelUsage: {},
    permission_denials: [],
    usage: {
      input_tokens: 1,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      iterations: [],
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard',
      inference_geo: 'us',
      speed: 'standard'
    }
  })
  await expect
    .poll(() => test.events.find((event) => event.type === 'error'))
    .toMatchObject({
      error: { message: 'Native failure' }
    })
  const resume = test.events.findIndex(
    (event) => event.type === 'resume-token' && event.token === context.nativeThreadId
  )
  expect(resume).toBeGreaterThanOrEqual(0)
  expect(resume).toBeLessThan(test.events.findIndex((event) => event.type === 'error'))
  expect(test.events.some((event) => event.type === 'turn-complete')).toBe(false)
  wire.exit()
})
