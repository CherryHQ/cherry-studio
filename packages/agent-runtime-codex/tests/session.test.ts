import { expect, it, vi } from 'vitest'

import { runtimeId, type SubmitResult } from '@cherrystudio/agent-runtime'

import { CodexSession, listCodexBuiltinCommands, type CodexSessionEvent } from '../src/session'
import { createPeer } from './peer'

async function openSession(
  approve: Parameters<typeof CodexSession.open>[1]['approve'] = async () => ({ approved: false }),
  interactions: Pick<Parameters<typeof CodexSession.open>[1], 'question' | 'form'> = {}
) {
  const peer = createPeer()
  const events: CodexSessionEvent[] = []
  const opened = CodexSession.open(
    { cwd: '/workspace', headless: false, signal: new AbortController().signal },
    {
      connect: (_args, handlers) => peer.connect(handlers),
      approve,
      ...interactions,
      emit: (event) => events.push(event)
    }
  )
  await peer.handshake()
  const models = await peer.read()
  peer.send({ id: models.id, result: { data: [{ id: 'model', displayName: 'Model' }] } })
  const thread = await peer.read()
  peer.send({ id: thread.id, result: { thread: { id: 'thread' }, model: 'model' } })
  const session = await opened

  async function start(turnId: string, beforeStartReply?: () => void) {
    const started = session.send([{ type: 'text', text: 'hello' }])
    const request = await peer.read()
    expect(request).toMatchObject({ method: 'turn/start', params: { threadId: 'thread' } })
    beforeStartReply?.()
    peer.send({ id: request.id, result: { turn: { id: turnId } } })
    await started
  }
  function complete(turnId: string) {
    peer.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: turnId, status: 'completed' } } })
  }
  return { peer, session, events, start, complete }
}

it('cancels a late approval and keeps old-turn content and completion out of the new turn', async () => {
  const approval = Promise.withResolvers<{ approved: boolean }>()
  const pending = Promise.withResolvers<AbortSignal>()
  const { peer, events, start, complete } = await openSession((_request, signal) => {
    pending.resolve(signal)
    return approval.promise
  })
  try {
    await start('one')
    peer.send({
      id: 'approval-1',
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread', turnId: 'one', itemId: 'edit' }
    })
    const signal = await pending.promise
    complete('one')
    await start('two', () => complete('one'))
    expect(signal.aborted).toBe(true)
    approval.resolve({ approved: true })
    expect(await peer.read()).toEqual({ id: 'approval-1', result: { decision: 'cancel' } })

    complete('one')
    for (const [threadId, turnId, delta] of [
      ['other', 'two', 'wrong thread'],
      ['thread', 'one', 'old'],
      ['thread', 'two', 'current']
    ]) {
      peer.send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'message', delta } })
    }
    complete('two')
    expect(events.map((event) => (event.type === 'text-append' ? event.text : event.type))).toEqual([
      'finished',
      'current',
      'finished'
    ])
  } finally {
    peer.close()
  }
})

it('undoes only the native tail, including an interrupted turn that predates this connection', async () => {
  const { peer, session, events } = await openSession()
  try {
    const undo = session.send([{ type: 'text', text: '/undo' }])
    const list = await peer.read()
    expect(list).toMatchObject({
      method: 'thread/turns/list',
      params: { threadId: 'thread', limit: 1, itemsView: 'summary', sortDirection: 'desc' }
    })
    peer.send({ id: list.id, result: { data: [{ id: 'B', status: 'interrupted' }] } })
    const revert = await peer.read()
    expect(revert).toMatchObject({ method: 'thread/revert', params: { threadId: 'thread', beforeTurnId: 'B' } })
    peer.send({ id: revert.id, result: { thread: { id: 'thread' } } })
    await undo
    expect(events).toContainEqual({ type: 'text', text: 'Reverted the last turn.' })
  } finally {
    peer.close()
  }
})

it('executes the exported clear alias and publishes the new thread identity', async () => {
  const { peer, session, events } = await openSession()
  try {
    expect(listCodexBuiltinCommands().find(({ name }) => name === 'clear')?.aliases).toContain('new')
    const sent = session.send([{ type: 'text', text: '/new' }])
    const request = await peer.read()
    expect(request.method).toBe('thread/start')
    peer.send({ id: request.id, result: { thread: { id: 'fresh' } } })
    await sent
    expect(session.id).toBe('fresh')
    expect(events).toContainEqual({ type: 'thread-changed', threadId: 'fresh' })
  } finally {
    peer.close()
  }
})

it('invokes a skill before opening the menu and refreshes the observed catalog while idle', async () => {
  const { peer, session, events, complete } = await openSession()
  const skill = { name: 'design', path: '/workspace/design/SKILL.md' }
  try {
    const sent = session.send([{ type: 'text', text: '/design review this' }])
    const discovery = await peer.read()
    expect(discovery).toMatchObject({ method: 'skills/list', params: { cwds: ['/workspace'] } })
    peer.send({ id: discovery.id, result: { data: [{ skills: [skill] }] } })
    const turn = await peer.read()
    expect(turn).toMatchObject({
      method: 'turn/start',
      params: {
        input: [
          { type: 'skill', ...skill },
          { type: 'text', text: 'review this' }
        ]
      }
    })
    peer.send({ id: turn.id, result: { turn: { id: 'one' } } })
    await sent
    complete('one')
    expect(await session.listCommands()).toContainEqual(expect.objectContaining({ name: 'design', builtin: false }))

    peer.send({ method: 'skills/changed' })
    const refresh = await peer.read()
    expect(refresh.method).toBe('skills/list')
    peer.send({
      id: refresh.id,
      result: {
        data: [
          {
            skills: [
              { ...skill, enabled: false },
              { name: 'new', path: '/new/SKILL.md' },
              { name: 'goal', path: '/goal/SKILL.md' }
            ]
          }
        ]
      }
    })
    await vi.waitFor(() => {
      const change = events.find((event) => event.type === 'supported-commands')
      expect(change?.commands.filter((command) => !command.builtin).map((command) => command.name)).toEqual(['goal'])
      expect(change?.commands).not.toContainEqual(expect.objectContaining({ name: 'goal', builtin: true }))
    })
  } finally {
    peer.close()
  }
})

it('owns a resumed turn when the response and its notifications share one stdout write', async () => {
  const peer = createPeer()
  const events: CodexSessionEvent[] = []
  try {
    const opened = CodexSession.open(
      {
        cwd: '/workspace',
        restore: { kind: 'required', threadId: 'original' },
        headless: false,
        signal: new AbortController().signal
      },
      {
        connect: (_args, handlers) => peer.connect(handlers),
        approve: async () => ({ approved: false }),
        emit: (event) => events.push(event)
      }
    )
    await peer.handshake('codex/0.145.0')
    const models = await peer.read()
    peer.send({ id: models.id, result: { data: [] } })
    const resume = await peer.read()
    expect(resume).toMatchObject({ method: 'thread/resume', params: { threadId: 'original', excludeTurns: true } })
    peer.stdout.write(
      [
        { id: resume.id, result: { thread: { id: 'original' } } },
        { method: 'turn/started', params: { threadId: 'original', turn: { id: 'auto' } } },
        {
          method: 'item/completed',
          params: {
            threadId: 'original',
            turnId: 'auto',
            item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Restored' }
          }
        },
        { method: 'turn/completed', params: { threadId: 'original', turn: { id: 'auto', status: 'completed' } } }
      ]
        .map((frame) => JSON.stringify(frame) + '\n')
        .join('')
    )
    await opened
    expect(events).toEqual([
      { type: 'native-start', threadId: 'original' },
      { type: 'text-finish', itemId: 'final', kind: 'agentMessage', phase: 'final_answer', text: 'Restored' },
      { type: 'finished', reason: 'stop', error: undefined },
      { type: 'native-finish' }
    ])
  } finally {
    peer.close()
  }
})

it('withdraws only the reverse request named by Codex', async () => {
  const pending = new Map<string, { signal: AbortSignal; resolve: (value: { approved: boolean }) => void }>()
  const { peer, start } = await openSession(
    (req, signal) => new Promise((resolve) => pending.set(req.itemId, { signal, resolve }))
  )
  try {
    await start('one')
    for (const id of ['a', 'b'])
      peer.send({
        id,
        method: 'item/fileChange/requestApproval',
        params: { threadId: 'thread', turnId: 'one', itemId: id }
      })
    await vi.waitFor(() => expect(pending.size).toBe(2))
    peer.send({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 'a' } })
    expect(pending.get('a')?.signal.aborted).toBe(true)
    expect(pending.get('b')?.signal.aborted).toBe(false)
    for (const id of ['a', 'b']) {
      pending.get(id)?.resolve({ approved: true })
      expect(await peer.read()).toEqual({ id, result: { decision: id === 'a' ? 'cancel' : 'accept' } })
    }
  } finally {
    peer.close()
  }
})

it('returns the selected label and notes under the native question ID, and the typed MCP form content', async () => {
  const { peer, start } = await openSession(undefined, {
    question: async () => [{ selected: ['Small'], notes: 'Limit the change to this file' }],
    form: async () => ({ action: 'accept', content: { count: 3 } })
  })
  try {
    await start('one')
    peer.send({
      id: 17,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread',
        turnId: 'one',
        itemId: 'ask',
        questions: [
          {
            id: 'scope',
            question: 'What scope?',
            header: 'Scope',
            isSecret: false,
            isOther: true,
            options: [{ label: 'Small', description: 'Focused change' }]
          }
        ]
      }
    })
    expect(await peer.read()).toEqual({
      id: 17,
      result: { answers: { scope: { answers: ['Small', 'user_note: Limit the change to this file'] } } }
    })
    peer.send({
      id: 'form',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread',
        turnId: null,
        mode: 'form',
        message: 'Count',
        requestedSchema: {
          type: 'object',
          properties: { count: { type: 'integer' } }
        }
      }
    })
    expect(await peer.read()).toEqual({ id: 'form', result: { action: 'accept', content: { count: 3 }, _meta: null } })
  } finally {
    peer.close()
  }
})

it('keeps Goal in slash commands and uses native Plan and steer settings', async () => {
  const peer = createPeer()
  const events: CodexSessionEvent[] = []
  try {
    const opened = CodexSession.open(
      { cwd: '/workspace', headless: false, signal: new AbortController().signal },
      {
        connect: (_args, handlers) => peer.connect(handlers),
        approve: async () => ({ approved: false }),
        emit: (event) => events.push(event)
      }
    )
    await peer.handshake('codex/0.172.0')
    peer.send({
      id: (await peer.read()).id,
      result: {
        data: [{ id: 'model', displayName: 'Model', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }]
      }
    })
    peer.send({
      id: (await peer.read()).id,
      result: { thread: { id: 'thread' }, model: 'model', reasoningEffort: 'high' }
    })
    for (let i = 0; i < 2; i++) {
      const request = await peer.read()
      peer.send({
        id: request.id,
        result:
          request.method === 'collaborationMode/list'
            ? { data: [{ mode: 'default' }, { mode: 'plan' }] }
            : { data: [{ name: 'goals', enabled: true }] }
      })
    }
    const goal = await peer.read()
    expect(goal.method).toBe('thread/goal/get')
    peer.send({ id: goal.id, result: { goal: null } })
    const session = await opened
    const setting = session.send([{ type: 'text', text: '/goal ship' }])
    const setGoal = await peer.read()
    expect(setGoal).toMatchObject({
      method: 'thread/goal/set',
      params: { threadId: 'thread', origin: 'user', objective: 'ship' }
    })
    peer.send({ id: setGoal.id, result: { goal: { threadId: 'thread', objective: 'ship', status: 'active' } } })
    await setting
    expect(session.info).not.toHaveProperty('configOptions')
    for (const [command, status] of [
      ['pause', 'paused'],
      ['resume', 'active']
    ] as const) {
      const updated = session.send([{ type: 'text', text: `/goal ${command}` }])
      const request = await peer.read()
      expect(request).toMatchObject({
        method: 'thread/goal/set',
        params: { threadId: 'thread', origin: 'user', status }
      })
      peer.send({ id: request.id, result: { goal: { threadId: 'thread', objective: 'ship', status } } })
      await updated
    }
    session.setMode('codex-mode', 'readOnly')
    const planned = session.send([{ type: 'text', text: 'review' }], 'first')
    const turn = await peer.read()
    expect(turn).toMatchObject({
      method: 'turn/start',
      params: {
        clientUserMessageId: 'first',
        collaborationMode: { mode: 'plan', settings: { model: 'model', reasoning_effort: 'high' } },
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        input: [{ type: 'text', text: 'review' }]
      }
    })
    peer.send({ id: turn.id, result: { turn: { id: 'native' } } })
    await planned
    const receipts: Promise<SubmitResult>[] = []
    for (const id of ['used', 'dropped']) {
      receipts.push(session.steer(runtimeId(id), async () => [{ type: 'text', text: id }]))
      const request = await peer.read()
      expect(request).toMatchObject({
        method: 'turn/steer',
        params: { expectedTurnId: 'native', clientUserMessageId: id }
      })
      peer.send({ id: request.id, result: { turnId: 'native' } })
    }
    expect(events.some((event) => event.type === 'steer-boundary')).toBe(false)
    const preparation = Promise.withResolvers<readonly []>()
    const preparing = session.steer(runtimeId('preparing'), () => preparation.promise)
    const stopping = session.interrupt()
    const interrupt = await peer.read()
    expect(interrupt).toMatchObject({ method: 'turn/interrupt', params: { turnId: 'native' } })
    await expect(preparing).resolves.toMatchObject({
      status: 'rejected',
      inputId: 'preparing',
      error: { code: 'cancelled-before-dispatch' }
    })
    preparation.resolve([])
    peer.send({ id: interrupt.id, result: {} })
    await stopping
    peer.send({
      method: 'item/started',
      params: { threadId: 'thread', turnId: 'native', item: { type: 'userMessage', id: 'echo', clientId: 'used' } }
    })
    peer.send({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: { id: 'native', status: 'interrupted' } }
    })
    expect(events).toContainEqual({ type: 'steer-boundary', inputIds: ['used'] })
    await expect(Promise.all(receipts)).resolves.toMatchObject([
      { status: 'acknowledged', inputId: 'used', facts: ['accepted', 'placed'] },
      { status: 'unknown', inputId: 'dropped', error: { code: 'missing-echo' } }
    ])
    session.setMode('codex-mode', 'workspace')
    const working = session.send([{ type: 'text', text: 'implement' }])
    const nextTurn = await peer.read()
    expect(nextTurn).toMatchObject({
      method: 'turn/start',
      params: {
        collaborationMode: { mode: 'default' },
        sandboxPolicy: { type: 'workspaceWrite' }
      }
    })
    peer.send({ id: nextTurn.id, result: { turn: { id: 'work' } } })
    await working
    peer.send({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: { id: 'work', status: 'completed' } }
    })
    await session.send([{ type: 'text', text: '/plan' }])
    expect(session.info.mode.currentValue).toBe('readOnly')
    await session.send([{ type: 'text', text: '/plan off' }])
    expect(session.info.mode.currentValue).toBe('workspace')
  } finally {
    peer.close()
  }
})

it('confirms standalone compaction from its own item and turn without opening a chat turn', async () => {
  const { peer, session, events } = await openSession()
  try {
    const compaction = session.compact()
    const request = await peer.read()
    expect(request).toMatchObject({ method: 'thread/compact/start', params: { threadId: 'thread' } })
    peer.send({ id: request.id, result: {} })
    peer.send({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'compact-turn' } } })
    for (const method of ['item/started', 'item/completed']) {
      peer.send({
        method,
        params: { threadId: 'thread', turnId: 'compact-turn', item: { id: 'compact-item', type: 'contextCompaction' } }
      })
    }
    peer.send({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: { id: 'compact-turn', status: 'completed' } }
    })
    await expect(compaction).resolves.toEqual({ status: 'confirmed', value: undefined })
    expect(events.filter(({ type }) => type === 'native-start' || type === 'finished')).toEqual([])
  } finally {
    peer.close()
  }
})
