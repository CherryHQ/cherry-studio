import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { query, type SDKResultSuccess, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { assistantMessage, wireProcess } from '../../../../../../packages/agent-runtime-claude-code/tests/wireFixture'
import { LocalClaudeConnection, probeLocalClaude } from '../../claudeCode/LocalClaudeConnection'
import type { ClaudeCodeProcessDiagnostics } from '../../claudeCode/processExitDiagnostics'
import type { AgentRuntimeEvent } from '../../types'
import { acquireLocalAgentBrowserLease } from '../browserBridge'
import { resolveLocalAgentLaunch, resolveLocalAgentModelLaunch } from '../launch'

vi.mock('@anthropic-ai/claude-agent-sdk', async (load) => {
  const sdk = await load<typeof import('@anthropic-ai/claude-agent-sdk')>()
  return { ...sdk, query: vi.fn(sdk.query) }
})
vi.mock(
  '@cherrystudio/agent-runtime-claude-code',
  () => import('../../../../../../packages/agent-runtime-claude-code/src')
)
vi.mock('../launch', () => ({ resolveLocalAgentLaunch: vi.fn(), resolveLocalAgentModelLaunch: vi.fn() }))
vi.mock('../browserBridge', async (load) => ({
  ...(await load<typeof import('../browserBridge')>()),
  acquireLocalAgentBrowserLease: vi.fn()
}))

const db = setupTestDatabase()
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  MockApplicationUtils.resetServices()
  vi.resetAllMocks()
})

async function transport() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'cherry-local-claude-')))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const wire = wireProcess()
  const executable = join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude')
  await writeFile(executable, '', { mode: 0o700 })
  const launch = {
    executable,
    source: 'system' as const,
    args: ['--verbose'],
    env: { CLAUDE_CONFIG_DIR: join(directory, 'profile') }
  }
  vi.mocked(resolveLocalAgentLaunch).mockResolvedValue(launch)
  vi.mocked(resolveLocalAgentModelLaunch).mockResolvedValue(launch)
  const spawn = vi.fn((_options: SpawnOptions, diagnostics: ClaudeCodeProcessDiagnostics) => {
    diagnostics.exited = new Promise<void>((resolve) => wire.process.once('exit', () => resolve()))
    return wire.process
  })
  MockApplicationUtils.setService('ClaudeCodeProcessManager', { spawn })
  return { directory, wire, launch, spawn }
}

const config: LocalAgentConfiguration = { protocol: 'claude', enabled: true, args: [], env: {}, nativeModel: 'sonnet' }

async function session(headless = false, resumeToken?: string) {
  const test = await transport()
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  db.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: test.directory, orderKey: 'a0' })
    .run()
  db.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Local', orderKey: 'a0' }).run()
  if (resumeToken) {
    const project = join(test.launch.env.CLAUDE_CONFIG_DIR, 'projects', test.directory.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(project, { recursive: true })
    const saved = {
      uuid: randomUUID(),
      sessionId: resumeToken,
      type: 'user',
      parentUuid: null,
      isSidechain: false,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'Saved in local profile' }] }
    }
    await writeFile(join(project, `${resumeToken}.jsonl`), JSON.stringify(saved) + '\n')
  }
  const connection = new LocalClaudeConnection(
    { sessionId, agentId: 'agent', modelId: 'runtime:agent', headless, resumeToken },
    config
  )
  const events: AgentRuntimeEvent[] = []
  const drain = (async () => {
    for await (const event of connection.events) events.push(event)
  })()
  cleanups.push(async () => {
    await connection.close()
    await drain
  })
  await connection.start(test.directory)
  const options = vi.mocked(query).mock.calls.at(-1)![0].options!
  const input = (text: string) => ({
    message: messages.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
  })
  return { ...test, connection, events, options, input }
}

function result(sessionId: string, userId: string, extra: Partial<SDKResultSuccess> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    uuid: randomUUID(),
    session_id: sessionId,
    user_message_uuid: userId,
    stop_reason: 'end_turn',
    is_error: false,
    result: '',
    modelUsage: {},
    usage: { input_tokens: 3, output_tokens: 5 },
    ...extra
  } as SDKResultSuccess
}

it('sends successive turns to the selected CLI in one SDK session with the local profile', async () => {
  const { connection, options, directory, spawn, wire, launch, events, input } = await session()
  expect(options).toMatchObject({
    cwd: directory,
    pathToClaudeCodeExecutable: launch.executable,
    model: 'sonnet',
    settingSources: ['user', 'project', 'local']
  })
  expect(spawn.mock.calls[0][0].env.CLAUDE_CONFIG_DIR).toBe(launch.env.CLAUDE_CONFIG_DIR)
  expect(spawn.mock.calls[0][0].args.at(-1)).toBe('--verbose')
  expect((await connection.getSupportedCommands())?.map((cmd) => cmd.name)).toContain('compact')
  for (const text of ['first', 'second']) {
    const turn = input(text)
    await connection.send(turn)
    await expect.poll(() => wire.inputs.at(-1)?.uuid).toBe(turn.message.id)
    const sent = wire.inputs.at(-1)!
    expect(sent.session_id).toBe(options.sessionId)
    expect(sent.uuid).toBe(turn.message.id)
    wire.send(assistantMessage(sent.session_id, [{ type: 'text', text, citations: null }]))
    wire.send(result(sent.session_id, sent.uuid!, { stop_reason: 'max_tokens' }))
    await expect.poll(() => events.filter((event) => event.type === 'turn-complete')).toHaveLength(wire.inputs.length)
  }
  expect(events).toContainEqual({ type: 'turn-complete', finishReason: 'length' })
  expect(events).toContainEqual({ type: 'resume-token', token: options.sessionId })
  expect(connection.localSessionInfo.activeModel?.id).toBeTruthy()
  expect(spawn).toHaveBeenCalledTimes(1)
  await connection.close()
  await expect(connection.send(input('closed'))).rejects.toThrow('unavailable')
  expect(wire.inputs).toHaveLength(2)
})

it('keeps a background result separate from the submitted turn and surfaces its native API failure', async () => {
  const { connection, input, wire, events } = await session()
  await connection.send(input('work'))
  await expect.poll(() => wire.inputs.length).toBe(1)
  const sent = wire.inputs[0]
  wire.send(result(sent.session_id, randomUUID(), { origin: { kind: 'task-notification', runId: 'old-task' } }))
  wire.send(result(sent.session_id, sent.uuid!, { api_error_status: 429, result: 'Rate limited' }))
  await expect
    .poll(() => events.find((event) => event.type === 'error'))
    .toMatchObject({ error: { message: 'Rate limited' } })
  expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
})

it('opens the transcript from the selected profile and resumes its original session ID', async () => {
  const id = randomUUID()
  const { options, events, connection, input, wire } = await session(false, id)
  expect(options.resume).toBe(id)
  expect(options.sessionId).toBeUndefined()
  await expect
    .poll(() =>
      events.flatMap((event) =>
        event.type === 'message-projection'
          ? event.projection.messages.flatMap((source) =>
              source.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
            )
          : []
      )
    )
    .toContain('Saved in local profile')
  await connection.send(input('continue'))
  await expect.poll(() => wire.inputs[0]?.session_id).toBe(id)
})

it('keeps scheduled execution read-only and fails a turn denied by the CLI', async () => {
  const { options, events, connection, input, wire } = await session(true)
  expect(options).toMatchObject({
    permissionMode: 'dontAsk',
    settingSources: [],
    tools: ['Read', 'Glob', 'Grep'],
    strictMcpConfig: true
  })
  expect(options.mcpServers).toBeUndefined()
  await expect(connection.setMode('claude-mode', 'bypassPermissions')).rejects.toThrow('Scheduled')
  await connection.send(input('scheduled task'))
  await expect.poll(() => wire.inputs.length).toBe(1)
  const sent = wire.inputs[0]
  wire.send(
    result(sent.session_id, sent.uuid!, {
      permission_denials: [{ tool_use_id: 'write-1', tool_name: 'Write', tool_input: {} }]
    })
  )
  await expect
    .poll(() => events.find((event) => event.type === 'error'))
    .toMatchObject({ error: { providerErrorCategory: 'permission' } })
  expect(events.some((event) => event.type === 'turn-complete' || event.type === 'tool-approval-request')).toBe(false)
})

it('applies session permissions and effort on the active query and still asks interactive questions', async () => {
  const { connection, options, events, spawn } = await session()
  const canUseTool = options.canUseTool!
  const signal = new AbortController().signal
  async function approval(call: string) {
    const event = await vi.waitFor(() => {
      const found = events.find((e) => e.type === 'tool-approval-request' && e.request.toolCallId === call)
      if (found?.type !== 'tool-approval-request') throw new Error('Waiting for native approval')
      return found
    })
    return event.request.approvalId
  }
  const first = canUseTool(
    'Bash',
    { command: 'pwd' },
    {
      toolUseID: 'first',
      signal,
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings' }]
    }
  )
  toolApprovalRegistry.dispatch(await approval('first'), {
    approved: true,
    updatedInput: { localPermissionOption: 'allow_session' }
  })
  await expect(first).resolves.toMatchObject({
    behavior: 'allow',
    updatedInput: { command: 'pwd' },
    updatedPermissions: [{ destination: 'session' }]
  })
  await expect(canUseTool('Bash', { command: 'pwd' }, { toolUseID: 'again', signal })).resolves.toEqual({
    behavior: 'allow',
    updatedInput: { command: 'pwd' }
  })
  await expect(connection.setMode('claude-mode', 'invalid')).rejects.toThrow()
  await connection.setMode('claude-mode', 'bypassPermissions')
  await connection.setThoughtLevel('claude-effort', 'high')
  expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('high')
  await connection.setThoughtLevel('claude-effort', 'default')
  const question = canUseTool('AskUserQuestion', {}, { signal, toolUseID: 'question' })
  toolApprovalRegistry.dispatch(await approval('question'), { approved: true, updatedInput: { answer: 'yes' } })
  await expect(question).resolves.toMatchObject({ behavior: 'allow', updatedInput: { answer: 'yes' } })
  expect(spawn).toHaveBeenCalledTimes(1)
})

it('binds browser permissions to the session mode and releases its lease', async () => {
  const dispose = vi.fn(async () => {})
  vi.mocked(acquireLocalAgentBrowserLease).mockResolvedValue({
    url: 'http://localhost/mcp',
    token: 'test',
    headers: { Authorization: 'Bearer test' },
    dispose
  })
  const { connection, options } = await session()
  const browser = vi.mocked(acquireLocalAgentBrowserLease).mock.calls[0][0]
  expect(options.mcpServers?.automation).toMatchObject({ type: 'http', url: 'http://localhost/mcp' })
  expect(browser.isReadOnly()).toBe(false)
  await connection.setMode('claude-mode', 'plan')
  expect(browser.isReadOnly()).toBe(true)
  await connection.close()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('reads the initialization catalog without submitting a prompt or creating a transcript', async () => {
  const { wire, spawn, launch, directory } = await transport()
  const catalog = await probeLocalClaude(config, directory, new AbortController())
  expect(catalog.models).toEqual([])
  expect(wire.inputs).toHaveLength(0)
  expect(wire.process.exitCode).toBe(0)
  expect(vi.mocked(query).mock.calls.at(-1)?.[0].options).toMatchObject({
    pathToClaudeCodeExecutable: launch.executable,
    tools: [],
    persistSession: false
  })
  expect(spawn.mock.calls[0][0].env.CLAUDE_CONFIG_DIR).toBe(launch.env.CLAUDE_CONFIG_DIR)
})
