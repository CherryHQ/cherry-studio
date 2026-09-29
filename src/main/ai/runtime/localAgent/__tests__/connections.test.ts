import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../../types'
import { AcpConnection } from '../AcpConnection'
import { CodexConnection } from '../CodexConnection'
import { listLocalAgentModels } from '../LocalRuntimeDriver'

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: async () => ({ ...process.env }) }))

const fixture = fileURLToPath(new URL('./fixtures/localAgent.mjs', import.meta.url))
const input = { message: { data: { parts: [{ type: 'text', text: 'hello' }] } } } as AgentRuntimeUserInput

describe('local protocol processes', () => {
  let cwd: string
  const connections: Array<AcpConnection | CodexConnection> = []
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'local-agent-contract-'))
    vi.mocked(application.getPath).mockReturnValue(cwd)
  })
  afterEach(async () => {
    await Promise.all(connections.splice(0).map((connection) => connection.close()))
    await rm(cwd, { recursive: true, force: true })
  })

  function create(protocol: 'acp' | 'codex', scenario = 'normal', nativeModel?: string) {
    const config: LocalAgentConfiguration = {
      protocol,
      nativeModel,
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, protocol, scenario],
      env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
    }
    const connection =
      protocol === 'acp'
        ? new AcpConnection('session', 'agent', config)
        : new CodexConnection('session', 'agent', config)
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    const text = () =>
      events
        .flatMap((event) => (event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []))
        .join('')
    return { connection, events, drained, text }
  }

  it('records only reported prompt usage, includes cache and reasoning, and resets between turns', async () => {
    const { connection, events, drained } = create('acp', 'usage')
    await connection.start(cwd)
    await connection.send(input)
    await connection.send(input)
    await connection.close()
    await drained
    const invocations = events.flatMap((event) => (event.type === 'usage' ? [event.invocation] : []))
    expect(invocations).toHaveLength(2)
    expect(invocations[0].usage).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      noCacheTokens: 100,
      reasoningTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 10
    })
    expect(invocations[1].usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, noCacheTokens: 3 })
    expect(invocations[0].requestId).not.toBe(invocations[1].requestId)
    expect(
      invocations.every((invocation) => invocation.messageAssociation === 'current-turn' && !invocation.metrics)
    ).toBe(true)
  })

  it('does not invent usage when the agent omits it', async () => {
    const { connection, events, drained } = create('acp')
    await connection.start(cwd)
    await connection.send(input)
    await connection.close()
    await drained
    expect(events.filter((event) => event.type === 'usage')).toEqual([])
  })

  // Enumeration must not infer, apply a stale saved model, or create a Codex thread.
  it.each(['acp', 'codex'] as const)('%s loads real model IDs without sending a prompt', async (protocol) => {
    const catalog = await listLocalAgentModels({
      protocol,
      enabled: false,
      nativeModel: 'stale-model',
      executableOverride: process.execPath,
      args: [fixture, protocol, 'normal'],
      env: { FIXTURE_LOG: path.join(cwd, 'models.jsonl') }
    })
    expect(catalog.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
    const wire = (await readFile(path.join(cwd, 'models.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.some((message) =>
        ['session/prompt', 'turn/start', 'thread/start', 'session/set_config_option'].includes(message.method)
      )
    ).toBe(false)
  })

  it('keeps an empty catalog when an ACP agent does not advertise model selection', async () => {
    const { connection } = create('acp', 'no-models')
    await connection.start(cwd, undefined, 'models')
    expect(connection.localSessionInfo.models).toEqual([])
  })

  it.each(['acp', 'codex'] as const)('%s applies the selected native model on connection', async (protocol) => {
    const { connection } = create(protocol, 'normal', 'fixture-model')
    await connection.start(cwd)
    expect(connection.localSessionInfo.activeModel?.id).toBe('fixture-model')
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const request = wire.find(
      (message) => message.method === (protocol === 'acp' ? 'session/set_config_option' : 'thread/start')
    )
    expect(request.params).toMatchObject(
      protocol === 'acp' ? { configId: 'model', value: 'fixture-model' } : { model: 'fixture-model' }
    )
  })

  it.each(['acp', 'codex'] as const)('%s handshake never sends a prompt', async (protocol) => {
    const { connection } = create(protocol)
    await connection.start(cwd, undefined, true)
    await connection.close()
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.some((message) => ['session/prompt', 'turn/start', 'thread/start', 'session/new'].includes(message.method))
    ).toBe(false)
    expect(wire[0].method).toBe('initialize')
  })

  it.each(['acp', 'codex'] as const)(
    '%s reuses its session for multiple turns and settles each once',
    async (protocol) => {
      const { connection, events, text } = create(protocol)
      await connection.start(cwd)
      await connection.send(input)
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))
      await connection.send(input)
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(2))
      expect(text()).toBe('turn 1: helloturn 2: hello')
      expect(connection.localSessionInfo.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
      expect(events.filter((event) => event.type === 'resume-token')).toEqual([
        { type: 'resume-token', token: 'native-session' }
      ])
    }
  )

  it('returns Cursor option IDs without conflating duplicate labels or splitting commas', async () => {
    const { connection, events, text } = create('acp', 'cursor-question')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing question')
    expect(approval.request.toolName).toBe('AskUserQuestion')
    expect(approval.request.input).toMatchObject({
      choiceOnly: true,
      questions: [{ id: 'features', multiSelect: true }]
    })
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { answerSelections: { features: ['two', 'one'] } }
    })
    await sending
    expect(text()).toContain(
      '"outcome":{"outcome":"answered","answers":[{"questionId":"features","selectedOptionIds":["two","one"]}]}'
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chunk',
        chunk: expect.objectContaining({
          type: 'tool-output-available',
          output: expect.objectContaining({ answers: { features: 'Same, label, Same, label' } })
        })
      })
    )
  })

  it.each([true, false])('returns the explicit Cursor plan decision: %s', async (approved) => {
    const { connection, events, text } = create('acp', 'cursor-plan')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing plan')
    expect(text()).toContain('## Plan')
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved })
    await sending
    expect(text()).toContain(`"outcome":{"outcome":"${approved ? 'accepted' : 'rejected'}"}`)
  })

  it.each(['cursor-question', 'cursor-plan'])('cancels %s on close without approval', async (scenario) => {
    const { connection, events } = create('acp', scenario)
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    await connection.close()
    await sending
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).toContain('"outcome":{"outcome":"cancelled"}')
    expect(toolApprovalRegistry.hasSession('session')).toBe(false)
  })

  it('preserves ACP permission option identity and scope', async () => {
    const { connection, events, text } = create('acp', 'permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
    expect(approval.request.input.localPermissionOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ optionId: 'always', kind: 'allow_always' })])
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'always' }
    })
    await sending
    expect(text()).toContain('"optionId":"always"')
    expect(
      events.filter((event) => event.type === 'chunk' && event.chunk.type === 'tool-output-available')
    ).toHaveLength(1)
  })

  it('settles a standalone ACP approval card even when the agent uses a separate execution tool ID', async () => {
    const { connection, events } = create('acp', 'standalone-permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: false,
      updatedInput: { localPermissionOption: 'deny' }
    })
    await sending
    expect(events).toContainEqual({
      type: 'chunk',
      chunk: {
        type: 'tool-output-available',
        toolCallId: 'tool',
        output: { outcome: 'selected', optionId: 'deny' },
        dynamic: true
      }
    })
  })

  it.each(['acp', 'codex'] as const)('%s denies outstanding approvals on close', async (protocol) => {
    const { connection, events, drained } = create(protocol, 'permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    await connection.close()
    await sending
    await drained
    expect(toolApprovalRegistry.hasSession('session')).toBe(false)
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).not.toContain('"decision":"accept"')
    expect(wire).not.toContain('"optionId":"once"')
    expect(wire).toContain(protocol === 'acp' ? '"outcome":"cancelled"' : '"decision":"cancel"')
  })

  it.each(['acp', 'codex'] as const)('%s preserves partial text when the process crashes', async (protocol) => {
    const { connection, events, text } = create(protocol, 'crash')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'error')).toBe(true))
    expect(text()).toBe('turn 1: ')
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
  })

  it('performs declared file and terminal callbacks only after write/execution approval', async () => {
    const { connection, events, text } = create('acp', 'callbacks')
    await connection.start(cwd)
    const sending = connection.send(input)
    for (let index = 0; index < 2; index++) {
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(index + 1)
      )
      const approval = events.filter((event) => event.type === 'tool-approval-request')[index]
      if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
      if (index === 0) await expect(readFile(path.join(cwd, 'callback.txt'), 'utf8')).rejects.toThrow()
      else expect(text()).not.toContain('terminal-result')
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    }
    await sending
    expect(await readFile(path.join(cwd, 'callback.txt'), 'utf8')).toBe('line1\nline2\nline3')
    expect(text()).toBe('turn 1: line2terminal-result')
    expect(
      events.filter((event) => event.type === 'chunk' && event.chunk.type === 'tool-output-available')
    ).toHaveLength(2)
  })

  it('suppresses ACP replay during load and rejects unsupported restore', async () => {
    const { connection, text } = create('acp')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    expect(text()).toBe('turn 1: hello')
    const unsupported = create('acp', 'no-resume').connection
    await expect(unsupported.start(cwd, 'native-session')).rejects.toThrow('cannot restore')
  })
})
