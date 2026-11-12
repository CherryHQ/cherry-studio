import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import type * as ClaudeSdk from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { MemoryService } from '@main/ai/memory/MemoryService'
import { BaseService } from '@main/core/lifecycle'

import type { RuntimeForkResult } from '../../fork'
import type * as Warmup from '../agentSessionWarmup'
import { ClaudeCodeRuntimeDriver } from '../ClaudeCodeRuntimeDriver'
import { ClaudeCodeSessionStateService } from '../ClaudeCodeSessionStateService'
import { ClaudeCodeWarmQueryManager } from '../ClaudeCodeWarmQueryManager'
import { forkClaudeSession } from '../claudeFork'
import * as processDiagnostics from '../processExitDiagnostics'

const memoryRuntimeMocks = vi.hoisted(() => ({ build: vi.fn(), startup: vi.fn(), runtime: vi.fn() }))
vi.mock('../agentSessionWarmup', async (original) => ({
  ...(await original<typeof Warmup>()),
  buildClaudeCodeQueryRequestForAgentSession: memoryRuntimeMocks.build
}))
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<typeof ClaudeSdk>()),
  startup: memoryRuntimeMocks.startup
}))
vi.mock('@cherrystudio/agent-runtime-claude-code', () => ({ createClaudeCodeRuntime: memoryRuntimeMocks.runtime }))

vi.mock('../forkWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../forkWorker.ts', import.meta.url), options)
}))

describe('Claude native forks', () => {
  it('maps UUIDs once in isolated SDK workers through a child and grandchild', async () => {
    const userUuid = '20249b48-e174-4610-84c2-af6224228290'
    let entries = [
      { type: 'user', uuid: userUuid, parentUuid: null, sessionId, message: { role: 'user', content: 'PAST_ONLY' } },
      {
        type: 'assistant',
        uuid: messageUuid,
        parentUuid: userUuid,
        sessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PAST_ONLY' }] }
      }
    ]
    let currentId = sessionId
    let currentUuid = messageUuid
    const parentEnv = process.env.CLAUDE_CONFIG_DIR
    for (const name of ['child', 'grandchild']) {
      const checkpoint = {
        runtime: 'claude-code',
        runtimeSessionId: currentId,
        messageUuid: currentUuid,
        configDir: directory
      }
      const worker = new Worker(new URL('../forkWorker.ts', import.meta.url), {
        workerData: {
          entries,
          checkpoint,
          checkpoints: [checkpoint],
          artifactDirectory: path.join(directory, name),
          targetCwd: directory
        },
        env: { ...process.env }
      })
      let result: RuntimeForkResult
      try {
        result = await new Promise<RuntimeForkResult>((resolve, reject) => {
          worker.once('message', (message) =>
            message.error ? reject(new Error(message.error)) : resolve(message.result)
          )
          worker.once('error', reject)
          worker.once('exit', (code) => reject(new Error('worker exited: ' + code)))
        })
      } finally {
        await worker.terminate()
      }
      const output = (await readFile(result.publish[0].source, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const mapped = output.find((entry) => entry.forkedFrom?.messageUuid === currentUuid)
      expect(mapped).toBeDefined()
      expect(mapped.uuid).not.toBe(currentUuid)
      expect(result.checkpoints[0]).toMatchObject({ messageUuid: mapped.uuid, configDir: directory })
      expect(JSON.stringify(output)).toContain('PAST_ONLY')
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(parentEnv)
      entries = output
      currentId = result.resumeToken
      currentUuid = mapped.uuid
      await rm(result.publish[0].source)
    }
  })
  const sessionId = '374c8467-e787-4c67-b890-a3d91b50dba6'
  const messageUuid = '9ad4b714-fe5d-4664-9f76-2b0cd13f4c03'
  let directory: string
  let file: string
  const entry = JSON.stringify({
    type: 'assistant',
    uuid: messageUuid,
    isSidechain: false,
    message: { content: '检查点' }
  })
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-checkpoint-test-'))
    file = path.join(directory, 'projects', 'project', sessionId + '.jsonl')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function forkInput() {
    const checkpoint = {
      runtime: 'claude-code' as const,
      runtimeSessionId: sessionId,
      messageUuid,
      configDir: directory
    }
    return {
      sourceSessionId: 'source',
      targetSessionId: 'child',
      targetCwd: directory,
      artifactDirectory: path.join(directory, 'artifacts'),
      checkpoint,
      checkpoints: [checkpoint],
      signal: new AbortController().signal
    }
  }

  it('rejects malformed native checkpoints before looking for history', async () => {
    const input = forkInput()
    input.checkpoint.messageUuid = 'not-a-uuid'
    await expect(forkClaudeSession(input)).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
  })

  it.each(['compaction', 'replacement'] as const)(
    'refuses a fork retaining source UUIDs in %s metadata',
    async (kind) => {
      const userUuid = '20249b48-e174-4610-84c2-af6224228290'
      const boundaryUuid = '590bf21c-a5c3-413d-821e-cd33a4016d33'
      const entries = [
        { type: 'user', uuid: userUuid, parentUuid: null, sessionId, message: { role: 'user', content: 'Before' } },
        kind === 'compaction'
          ? {
              type: 'system',
              subtype: 'compact_boundary',
              uuid: boundaryUuid,
              parentUuid: userUuid,
              sessionId,
              compactMetadata: {
                trigger: 'auto',
                preTokens: 1000,
                preservedSegment: { headUuid: userUuid, tailUuid: userUuid, anchorUuid: boundaryUuid }
              }
            }
          : { type: 'content-replacement', sessionId, replacements: [{ messageUuid: userUuid, content: 'Replaced' }] },
        {
          type: 'assistant',
          uuid: messageUuid,
          parentUuid: kind === 'compaction' ? boundaryUuid : userUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'After' }] }
        }
      ]
      await mkdir(path.dirname(file), { recursive: true })
      const source = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
      await writeFile(file, source)
      await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
      expect(await readFile(file, 'utf8')).toBe(source)
    }
  )

  it.each(['\n', '\r\n'])('forks the exact UUID on demand and excludes later history (%j)', async (newline) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      entry +
        newline +
        JSON.stringify({ type: 'user', uuid: 'future-message', message: { content: 'FUTURE_ONLY' } }) +
        newline
    )
    const before = await readFile(file)
    const result = await forkClaudeSession(forkInput())
    const output = await readFile(result.publish[0].source, 'utf8')
    expect(output).not.toContain('FUTURE_ONLY')
    expect(JSON.parse(output.trim().split('\n')[0]).forkedFrom.messageUuid).toBe(messageUuid)
    expect(result.resumeToken).not.toBe(sessionId)
    expect(await readFile(file)).toEqual(before)
  })

  it.each([
    { name: 'empty LF', framing: '\n', leading: '', newline: '\n' },
    { name: 'empty CRLF', framing: '\r\n', leading: '', newline: '\r\n' },
    { name: 'spaces and tabs', framing: '\t  \n', leading: '', newline: '\n' },
    { name: 'leading blank', framing: '\n', leading: '\n', newline: '\n' },
    { name: 'consecutive blanks', framing: '\n\n', leading: '', newline: '\n' }
  ])(
    'forks blank-framed committed history without changing source bytes or including later turns ($name)',
    async ({ framing, leading, newline }) => {
      const userUuid = '20249b48-e174-4610-84c2-af6224228290'
      const inheritedUuid = '590bf21c-a5c3-413d-821e-cd33a4016d33'
      const futureUuid = '706dc088-43ba-425e-ae5e-64d436fbdccb'
      const entries = [
        {
          type: 'user',
          uuid: userUuid,
          parentUuid: null,
          sessionId,
          message: { role: 'user', content: 'EARLIER_USER' }
        },
        {
          type: 'assistant',
          uuid: inheritedUuid,
          parentUuid: userUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'INHERITED_ASSISTANT' }] }
        },
        {
          type: 'assistant',
          uuid: messageUuid,
          parentUuid: inheritedUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'EARLIER_ASSISTANT 检查点' }] }
        },
        {
          type: 'user',
          uuid: futureUuid,
          parentUuid: messageUuid,
          sessionId,
          message: { role: 'user', content: 'FUTURE_ONLY' }
        }
      ].map((value) => JSON.stringify(value))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(
        file,
        leading +
          entries[0] +
          newline +
          entries[1] +
          newline +
          framing +
          entries[2] +
          newline +
          newline +
          entries[3] +
          newline
      )
      const before = await readFile(file)
      const input = forkInput()
      input.checkpoints = [{ ...input.checkpoint, messageUuid: inheritedUuid }, input.checkpoint]

      const result = await forkClaudeSession(input)

      expect(result.resumeToken).not.toBe(sessionId)
      const output = await readFile(result.publish[0].source, 'utf8')
      expect(output).toContain('EARLIER_USER')
      expect(output).toContain('INHERITED_ASSISTANT')
      expect(output).toContain('EARLIER_ASSISTANT 检查点')
      expect(output).not.toContain('FUTURE_ONLY')
      expect(output).not.toContain(futureUuid)
      const assistants = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((value) => value.type === 'assistant')
      expect(assistants.map((value) => value.forkedFrom.messageUuid)).toEqual([inheritedUuid, messageUuid])
      expect(result.checkpoints).toEqual(
        assistants.map((value) => ({
          ...input.checkpoint,
          runtimeSessionId: result.resumeToken,
          messageUuid: value.uuid
        }))
      )
      expect(await readFile(file)).toEqual(before)
    }
  )

  it.each([
    ['all blank', '\n\r\n\t  \n'],
    ['bare CR', entry + '\r'],
    ['unterminated checkpoint after a committed record', '{"type":"user"}\n' + entry]
  ])('reports missing history for %s without a committed checkpoint', async (_name, content) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason: 'history_missing' })
  })

  it('forks a committed checkpoint before an incomplete tail', async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, entry + '\n\n{"type":"user","message":"INCOMPLETE_TAIL')
    const before = await readFile(file)
    const result = await forkClaudeSession(forkInput())
    const output = await readFile(result.publish[0].source, 'utf8')
    expect(JSON.parse(output.trim().split('\n')[0]).forkedFrom.messageUuid).toBe(messageUuid)
    expect(output).not.toContain('INCOMPLETE_TAIL')
    expect(await readFile(file)).toEqual(before)
  })

  it.each([
    ['missing', '', 'history_missing'],
    ['unflushed', entry, 'history_missing'],
    ['corrupt', 'invalid-json\n' + entry + '\n', 'history_corrupt']
  ])('reports %s history instead of selecting another boundary', async (_name, content, reason) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason })
  })
})

describe('Claude warm memory handoff', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
  })

  it.each(['open', 'handoff', 'none'] as const)('guards the runtime receiver when invalidated at %s', async (phase) => {
    const root = await mkdtemp(path.join(tmpdir(), 'claude-memory-handoff-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(root, key, name ?? ''))
    vi.spyOn(processDiagnostics, 'createClaudeCodeProcessDiagnostics').mockImplementation(() => ({
      reference: crypto.randomUUID(),
      exited: Promise.resolve()
    }))
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'A', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentWorkspaceTable).values({ id: 'workspace', name: 'W', path: root, orderKey: 'a0' }).run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'S', orderKey: 'a0' })
      .run()
    await mkdir(path.join(root, 'feature.agents.data', 'agent'), { recursive: true })
    const memory = new MemoryService()
    const manager = new ClaudeCodeWarmQueryManager()
    MockApplicationUtils.setService('MemoryService', memory)
    MockApplicationUtils.setService('ClaudeCodeWarmQueryManager', manager)
    MockApplicationUtils.setService('ClaudeCodeSessionStateService', new ClaudeCodeSessionStateService())
    const editor = memory.open({ scope: { kind: 'shared' }, assertAuthorized: () => undefined })
    await editor.entry()
    const file = path.join(root, 'feature.memory.data', 'MEMORY.md')
    await writeFile(file, 'OLD_FACT_TOOL_RESULT_SUMMARY')
    const clear = async () => {
      const preview = await editor.previewClear()
      await editor.clear(preview.token, async () => () => undefined)
    }
    const warm = { query: () => undefined, [Symbol.asyncDispose]: async () => undefined }
    const request = { key: 'session', options: { model: 'sonnet', resume: 'native-old', cwd: root }, settings: {} }
    memoryRuntimeMocks.build.mockResolvedValue(request)
    memoryRuntimeMocks.startup.mockResolvedValue(warm)
    const received: unknown[] = []
    let observe: ((batch: any) => Promise<void>) | undefined
    const handle = {
      thread: { id: 'native-old' },
      claude: {
        start: (query: unknown) => {
          received.push(query)
          return { status: 'confirmed' }
        },
        observe: async (listener: typeof observe) => {
          observe = listener
          if (phase === 'handoff') await clear()
          return { status: 'confirmed', value: { drain: async () => {}, stop: async () => {} } }
        }
      }
    }
    memoryRuntimeMocks.runtime.mockReturnValue({
      open: async () => {
        if (phase === 'open') await clear()
        return { status: 'confirmed', value: handle }
      },
      shutdown: async () => {
        await observe?.({ events: [{ type: 'closed', reason: 'shutdown' }], retracted: [], invocations: [] })
        return { status: 'confirmed' }
      }
    })
    try {
      await manager.prewarm(request)
      const connecting = new ClaudeCodeRuntimeDriver().connect({
        agentId: 'agent',
        sessionId: 'session',
        modelId: 'test::test',
        resumeToken: 'native-old'
      })
      if (phase === 'none') {
        const connection = await connecting
        expect(received).toEqual([{ query: warm, exited: expect.any(Promise) }])
        await connection.close()
      } else {
        await expect(connecting).rejects.toThrow()
        expect(received).toEqual([])
        expect(await readFile(file, 'utf8')).not.toContain('OLD_FACT_TOOL_RESULT_SUMMARY')
      }
    } finally {
      await manager.closeAll()
      editor.dispose()
      await memory['onStop']()
    }
  })
})
