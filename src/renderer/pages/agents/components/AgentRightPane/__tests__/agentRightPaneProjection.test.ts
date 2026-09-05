import { getPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import {
  buildAgentRightPaneStatus,
  buildAgentToolFlowProjection,
  resolveFlowToolCallId
} from '../agentRightPaneProjection'

const message = (id: string, parts: CherryMessagePart[]): CherryUIMessage =>
  ({
    id,
    role: 'assistant',
    parts,
    metadata: {},
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z'
  }) as CherryUIMessage

const toolPart = (
  toolCallId: string,
  toolName: string,
  parentToolCallId?: string,
  state = 'output-available',
  input?: unknown,
  output?: unknown
): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    output,
    callProviderMetadata: {
      'claude-code': {
        parentToolCallId: parentToolCallId ?? null
      }
    }
  }) as unknown as CherryMessagePart

// A dsh-runtime tool part: runtime-native lowercase name plus the cherry transport tag its
// stream adapter stamps — the tag is what lets the projection resolve the canonical tool name.
const dshToolPart = (toolCallId: string, toolName: string, state: string, input?: unknown): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    callProviderMetadata: {
      cherry: { transport: 'dsh-agent', tool: { type: 'builtin', name: toolName } }
    }
  }) as unknown as CherryMessagePart

const textPart = (text: string, parentToolCallId?: string): CherryMessagePart =>
  ({
    type: 'text',
    text,
    providerMetadata: parentToolCallId
      ? {
          'claude-code': {
            parentToolCallId
          }
        }
      : undefined
  }) as unknown as CherryMessagePart

describe('agent right pane projections', () => {
  it('builds a selected tool subtree with text and reasoning parts owned by that subtree', () => {
    const parts = [
      toolPart(
        'root',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Explore the repo' },
        'Async agent launched successfully.\nagentId: b1c2d3e4f5a6b7c8'
      ),
      textPart('child agent text', 'root'),
      toolPart('child', 'Read', 'root'),
      {
        type: 'reasoning',
        text: 'child reasoning',
        providerMetadata: {
          'claude-code': {
            parentToolCallId: 'child'
          }
        }
      } as unknown as CherryMessagePart,
      textPart('outside')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.selectedToolCallIds).toEqual(new Set(['root', 'child']))
    expect(projection.messages.map((item) => item.id)).toEqual(['root:agent-flow-prompt', 'root:agent-flow-assistant'])
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toHaveLength(3)
    expect(projection.partsByMessageId['root:agent-flow-assistant'][1]).not.toBe(parts[2])
    expect(getPartParentToolCallId(projection.partsByMessageId['root:agent-flow-assistant'][1])).toBeUndefined()
    expect(Object.values(projection.partsByMessageId).flat()).not.toContain(parts[0])
    expect(Object.values(projection.partsByMessageId).flat()).not.toContain(parts[4])
    expect((projection.partsByMessageId['root:agent-flow-prompt'][0] as { text?: string }).text).toBe(
      'Explore the repo'
    )

    const nextProjection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')
    expect(nextProjection.partsByMessageId['root:agent-flow-assistant'][0]).toBe(
      projection.partsByMessageId['root:agent-flow-assistant'][0]
    )
    expect(nextProjection.partsByMessageId['root:agent-flow-assistant'][1]).toBe(
      projection.partsByMessageId['root:agent-flow-assistant'][1]
    )
  })

  // A cold reconnect can bind a resumed task to its SendMessage receipt — the entry must redirect
  // to the launch root, or the flow opens empty.
  it('resolves a send-message bound entry back to the launch root', () => {
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the review' },
        'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
      ),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', summary: 'Finish the review', message: 'Please finalize' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      )
    ]
    const partsByMessageId = { m1: parts }

    expect(resolveFlowToolCallId('call_resume', partsByMessageId)).toEqual({
      toolCallId: 'call_launch',
      description: 'Launch the review'
    })
    expect(resolveFlowToolCallId('call_launch', partsByMessageId)).toBeUndefined()
    expect(resolveFlowToolCallId('missing', partsByMessageId)).toBeUndefined()
  })

  // A SendMessage receipt resolving to the selected launch splits its timeline: the prompt of
  // each continuation lands as a user message between the agent's rounds.
  it('interleaves resume prompts between the rounds of a continued agent', () => {
    const launchOutput =
      'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch the review' }, launchOutput),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', summary: 'Finish the review', message: 'Please finalize the four conclusions' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      ),
      textPart('Second round findings', 'call_launch')
    ]
    const messages = [message('m1', parts)]

    // Resolved output deliberately unset — the production path derives it from the part.
    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')

    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant',
      'call_launch:agent-flow-resume-1',
      'call_launch:agent-flow-assistant-1'
    ])
    const texts = (id: string) => projection.partsByMessageId[id].map((part) => (part as { text?: string }).text)
    expect(texts('call_launch:agent-flow-prompt')).toEqual(['Launch the review'])
    // The receipt's own result text is not appended anywhere — it duplicates the agent's final
    // message above and would go stale across continuations.
    expect(texts('call_launch:agent-flow-assistant')).toEqual(['First round findings'])
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Please finalize the four conclusions'])
    expect(texts('call_launch:agent-flow-assistant-1')).toEqual(['Second round findings'])
  })

  // Production ordering: the host row (holding both rounds) predates the receipt row, so position
  // alone puts the resume prompt AFTER all content. Runtime-tagged parts must win.
  it('splits rounds by runtime markers even when the receipt row comes last', () => {
    const marker = { 'claude-code': { parentToolCallId: 'call_launch' }, cherry: { resumedViaCallId: 'call_send' } }
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the review' },
        'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
      ),
      textPart('First round findings', 'call_launch'),
      {
        type: 'text',
        text: 'Second round findings',
        providerMetadata: marker
      } as unknown as CherryMessagePart,
      toolPart(
        'call_send',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', message: 'Please finalize' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      )
    ]
    const messages = [message('m1', parts), message('m2', [parts[3]])]

    // Simulate real walk order: m1 first (all content), then m2 (receipt).
    const projection = buildAgentToolFlowProjection(
      messages,
      { m1: [parts[0], parts[1], parts[2]], m2: [parts[3]] },
      'call_launch'
    )

    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant',
      'call_launch:agent-flow-resume-1',
      'call_launch:agent-flow-assistant-1'
    ])
    const texts = (id: string) => projection.partsByMessageId[id].map((part) => (part as { text?: string }).text)
    expect(texts('call_launch:agent-flow-assistant')).toEqual(['First round findings'])
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Please finalize'])
    expect(texts('call_launch:agent-flow-assistant-1')).toEqual(['Second round findings'])
  })

  // A send to a still-running agent returns the queued form — no resumedAgentId, only pin.id.
  // It must split the rounds and backfill its prompt just like a resume receipt does.
  it('interleaves the queued instruction for a send to a running agent', () => {
    const launchOutput =
      'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
    const queuedOutput = {
      success: true,
      message: 'Message queued for delivery at its next tool round.',
      pin: { id: 'af5051807ed7aaa30', name: 'reviewer', ref: 'abc' }
    }
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch the review' }, launchOutput),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_queue',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', summary: 'Reread files', message: 'Please reread the four files' },
        queuedOutput
      ),
      textPart('Second round findings', 'call_launch')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')

    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant',
      'call_launch:agent-flow-resume-1',
      'call_launch:agent-flow-assistant-1'
    ])
    const texts = (id: string) => projection.partsByMessageId[id].map((part) => (part as { text?: string }).text)
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Please reread the four files'])
    expect(texts('call_launch:agent-flow-assistant-1')).toEqual(['Second round findings'])
  })

  // When the receipt and the tagged content share one row with the receipt first, the position
  // split must consume the call id so the marker cannot split a second time.
  // A sibling agent's marker (parent = its own root, receipt owned elsewhere) must not split this
  // flow — the walk passes foreign detached rows before reaching the selected agent's receipt.
  it('ignores a sibling agent marker when splitting rounds', () => {
    const ownReceipt = {
      success: true,
      resumedAgentId: 'af5051807ed7aaa30',
      pin: { id: 'af5051807ed7aaa30', name: 'reviewer', ref: 'a' }
    }
    const siblingMarker = {
      type: 'text',
      text: 'sibling agent round content',
      providerMetadata: {
        'claude-code': { parentToolCallId: 'call_sibling_root' },
        cherry: { resumedViaCallId: 'call_send_sibling' }
      }
    } as unknown as CherryMessagePart
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the review' },
        'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
      ),
      textPart('First round findings', 'call_launch'),
      toolPart('call_sibling_root', 'Agent', undefined, 'output-available', { prompt: 'Sibling task' }, 'ok'),
      siblingMarker,
      toolPart(
        'call_send',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', message: 'Please finalize' },
        ownReceipt
      ),
      {
        type: 'text',
        text: 'Second round findings',
        providerMetadata: {
          'claude-code': { parentToolCallId: 'call_launch' },
          cherry: { resumedViaCallId: 'call_send' }
        }
      } as unknown as CherryMessagePart
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')

    // Exactly one resume split: prompt2 lands before its own round, never after the sibling's.
    expect(projection.messages.filter((item) => item.role === 'user')).toHaveLength(2)
    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant',
      'call_launch:agent-flow-resume-1',
      'call_launch:agent-flow-assistant-1'
    ])
  })

  // A blank launch description must not suppress the prompt-based identity fallback.
  it('falls back to the prompt when the launch description is blank', () => {
    const partsByMessageId = {
      m1: [
        toolPart(
          'call_launch',
          'Agent',
          undefined,
          'output-available',
          { description: '   ', prompt: 'Launch the review' },
          'Async agent launched successfully.\nagentId: af5051807ed7aaa30'
        ),
        toolPart(
          'call_resume',
          'SendMessage',
          undefined,
          'output-available',
          { to: 'af5051807ed7aaa30' },
          { success: true, resumedAgentId: 'af5051807ed7aaa30' }
        )
      ]
    }

    expect(resolveFlowToolCallId('call_resume', partsByMessageId)).toEqual({
      toolCallId: 'call_launch',
      description: 'Launch the review'
    })
  })

  // The adapter-stamped launch root resolves even when the launch row itself is paged out of the
  // loaded window and the map scan cannot find it.
  it('resolves a stamped receipt without its launch row in the window', () => {
    const partsByMessageId = {
      m2: [
        {
          ...toolPart(
            'call_send',
            'SendMessage',
            undefined,
            'output-available',
            { to: 'af5051807ed7aaa30', summary: 'Finish it', message: 'Please finalize' },
            { success: true, resumedAgentId: 'af5051807ed7aaa30' }
          )
        }
      ]
    }
    const stamped = partsByMessageId.m2[0] as CherryMessagePart & {
      callProviderMetadata: Record<string, Record<string, unknown>>
    }
    stamped.callProviderMetadata.cherry = { launchToolCallId: 'call_launch' }

    expect(resolveFlowToolCallId('call_send', partsByMessageId)).toEqual({ toolCallId: 'call_launch' })
  })

  it('does not duplicate the resume prompt when the receipt precedes its tagged content', () => {
    const marker = { 'claude-code': { parentToolCallId: 'call_launch' }, cherry: { resumedViaCallId: 'call_send' } }
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the review' },
        'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'
      ),
      toolPart(
        'call_send',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', message: 'Please finalize' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      ),
      {
        type: 'text',
        text: 'Second round findings',
        providerMetadata: marker
      } as unknown as CherryMessagePart
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')

    const userMessages = projection.messages.filter((item) => item.role === 'user')
    expect(userMessages).toHaveLength(2) // launch prompt + exactly one resume prompt
    const texts = userMessages.map((item) => (item.parts[0] as { text?: string }).text)
    expect(texts).toEqual(['Launch the review', 'Please finalize'])
    // The first (empty) round emits no segment; the tagged content forms the single assistant one.
    expect(projection.messages.filter((item) => item.role === 'assistant').map((item) => item.id)).toEqual([
      'call_launch:agent-flow-assistant-1'
    ])
  })

  // Oversized receipts arrive as deferred envelopes; the resolved output must still carry the
  // agent id so the continuation splits the timeline.
  it('splits resume rounds for a deferred launch receipt via the resolved output', () => {
    const deferred = { $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'call_launch' } }
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch the review' }, deferred),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      ),
      textPart('Second round findings', 'call_launch')
    ]
    const messages = [message('m1', parts)]
    const resolvedOutput =
      'Async agent launched successfully.\nagentId: af5051807ed7aaa30 (internal metadata - do not mention to user.)'

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch', resolvedOutput)

    // The receipt splits the rounds even though this particular send carried no prompt text
    // (no resume user message is rendered for it).
    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant',
      'call_launch:agent-flow-assistant-1'
    ])
  })

  it('uses a lazily resolved selected output and preserves child parts untouched', () => {
    const deferred = { $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'root' } }
    const selected = toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Explore the repo' }, deferred)
    const child = toolPart(
      'child',
      'Read',
      'root',
      'output-available',
      { file_path: '/tmp/example' },
      {
        $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'child' }
      }
    )
    const parts = [selected, child]
    const messages = [message('m1', parts)]

    // The launch receipt's own result text is no longer appended to the flow — it duplicates the
    // agent's final message and goes stale across continuations.
    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([
      expect.objectContaining({ toolCallId: 'child' })
    ])
  })

  it('keeps a foreground task result when its lifecycle event is present', () => {
    const selected = toolPart(
      'root',
      'Agent',
      undefined,
      'output-available',
      { prompt: 'Explore the repo' },
      'Repository review complete'
    )
    const started = {
      type: 'data-agent-task-event',
      data: {
        event: 'started',
        taskId: 'task-1',
        toolUseId: 'root',
        status: 'in_progress',
        title: 'Explore the repo'
      }
    } as unknown as CherryMessagePart
    const parts = [selected, started]

    const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')

    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([
      { type: 'text', text: 'Repository review complete' }
    ])
  })

  it('hides a legacy background launch receipt without borrowing task status', () => {
    const selected = toolPart(
      'root',
      'Agent',
      undefined,
      'output-available',
      { prompt: 'Explore the repo' },
      'Async agent launched successfully. Internal id: task-1; output_file: /tmp/task-1.output'
    )
    const parts = [selected, textPart('child agent text', 'root')]

    const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')
    const assistantParts = projection.partsByMessageId['root:agent-flow-assistant'] as Array<{ text?: string }>

    expect(assistantParts.map((part) => part.text).filter(Boolean)).toEqual(['child agent text'])
    expect(JSON.stringify(assistantParts)).not.toContain('Async agent launched successfully')
    expect(JSON.stringify(assistantParts)).not.toContain('/tmp/task-1.output')
  })

  it.each(['async_launched', 'remote_launched'] as const)(
    'hides a structured %s receipt without borrowing task status',
    (status) => {
      const selected = toolPart(
        'root',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Explore the repo' },
        { status, agentId: 'internal-agent-id' }
      )
      const parts = [selected, textPart('child agent text', 'root')]

      const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')
      const assistantParts = projection.partsByMessageId['root:agent-flow-assistant']

      expect(assistantParts).toEqual([expect.objectContaining({ type: 'text', text: 'child agent text' })])
      expect(JSON.stringify(assistantParts)).not.toContain('internal-agent-id')
    }
  )

  it('degrades to the selected tool prompt when child metadata is missing', () => {
    const parts = [
      toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Run the subagent' }),
      textPart('unowned child text')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.messages.map((item) => item.id)).toEqual(['root:agent-flow-prompt'])
    expect((projection.partsByMessageId['root:agent-flow-prompt'][0] as { text?: string }).text).toBe(
      'Run the subagent'
    )
  })

  it('keeps the flow assistant pending while the selected tool subtree is streaming', () => {
    const parts = [toolPart('root', 'Agent', undefined, 'input-available', { prompt: 'Run the subagent' })]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')
    const assistant = projection.messages.find((item) => item.role === 'assistant')

    expect(assistant?.metadata?.status).toBe('pending')
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([])
  })

  it('includes live overlay parts that do not have a persisted message row yet', () => {
    const parts = [
      toolPart('root', 'Agent', undefined, 'input-available', { prompt: 'Run the subagent' }),
      toolPart('child', 'Read', 'root', 'input-streaming')
    ]

    const projection = buildAgentToolFlowProjection([], { live: parts }, 'root')

    expect(projection.selectedToolCallIds).toEqual(new Set(['root', 'child']))
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toHaveLength(1)
  })

  // TodoWrite snapshots and the task ledger both describe the same plan, so the most
  // recently written source owns the status list.
  it('lets the most recent plan writer win between TodoWrite snapshots and the task ledger', () => {
    const snapshotThenLedger = [
      toolPart('todos-1', 'TodoWrite', undefined, 'output-available', {
        todos: [
          { content: 'Design pane', activeForm: 'Designing pane', status: 'completed' },
          { content: 'Wire flow', activeForm: 'Wiring flow', status: 'in_progress' }
        ]
      }),
      toolPart(
        'task-list',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [{ id: 'task-1', subject: 'Review context', status: 'pending', blockedBy: [] }]
        }
      )
    ]

    const ledgerWins = buildAgentRightPaneStatus([message('m1', snapshotThenLedger)], { m1: snapshotThenLedger })
    expect(ledgerWins.tasks.map((task) => task.title)).toEqual(['Review context'])
    expect(ledgerWins.completedTaskCount).toBe(0)
    expect(ledgerWins.totalTaskCount).toBe(1)

    const ledgerThenSnapshot = [
      ...snapshotThenLedger,
      toolPart('todos-2', 'TodoWrite', undefined, 'output-available', {
        todos: [{ content: 'Polish the pane', activeForm: 'Polishing the pane', status: 'in_progress' }]
      })
    ]

    const snapshotWins = buildAgentRightPaneStatus([message('m1', ledgerThenSnapshot)], { m1: ledgerThenSnapshot })
    expect(snapshotWins.tasks.map((task) => task.title)).toEqual(['Polish the pane'])
    expect(snapshotWins.totalTaskCount).toBe(1)
  })

  it('keeps the plan owned by the main agent when spawned runs write todos or tasks', () => {
    const parts = [
      toolPart('todos-main', 'TodoWrite', undefined, 'output-available', {
        todos: [
          { content: 'Design pane', activeForm: 'Designing pane', status: 'completed' },
          { content: 'Wire flow', activeForm: 'Wiring flow', status: 'in_progress' }
        ]
      }),
      // Spawned-run parts arrive parented under their Task tool call and must not own the plan.
      toolPart('child-todos', 'TodoWrite', 'parent-task-call', 'output-available', {
        todos: [{ content: 'Subagent todo', status: 'in_progress' }]
      }),
      toolPart(
        'child-task-create',
        'TaskCreate',
        'parent-task-call',
        'output-available',
        { subject: 'Subagent ledger row' },
        {
          task: { id: '1', subject: 'Subagent ledger row' }
        }
      ),
      // The dsh runtime parents spawned-run parts through its own metadata namespace.
      {
        type: 'dynamic-tool',
        toolCallId: 'dsh-child-todos',
        toolName: 'todo_write',
        state: 'output-available',
        input: { todos: [{ content: 'Dsh child todo', status: 'in_progress' }] },
        callProviderMetadata: {
          cherry: {
            transport: 'dsh-agent',
            parentToolCallId: 'dsh-parent-task-call',
            tool: { type: 'builtin', name: 'todo_write' }
          }
        }
      } as unknown as CherryMessagePart
    ]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts })

    expect(status.tasks.map((task) => task.title)).toEqual(['Design pane', 'Wire flow'])
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(2)
  })

  it('projects the latest successful dsh todo_write snapshot into status tasks', () => {
    const parts = [
      dshToolPart('dsh-todos-1', 'todo_write', 'output-available', {
        todos: [
          { content: 'Inspect the runtime', status: 'completed' },
          { content: 'Wire the status pane', status: 'in_progress' }
        ]
      }),
      dshToolPart('dsh-todos-failed', 'todo_write', 'output-error', {
        todos: [{ content: 'Do not show this failed snapshot', status: 'in_progress' }]
      }),
      dshToolPart('dsh-todos-2', 'todo_write', 'output-available', {
        todos: [
          { content: 'Wire the status pane', status: 'completed' },
          { content: 'Verify the projection', status: 'pending' }
        ]
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks.map(({ title, status }) => ({ title, status }))).toEqual([
      {
        title: 'Wire the status pane',
        status: 'completed'
      },
      {
        title: 'Verify the projection',
        status: 'pending'
      }
    ])
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(2)
  })

  it('clears dsh status tasks when todo_write succeeds with an empty snapshot', () => {
    const parts = [
      dshToolPart('dsh-todos-1', 'todo_write', 'output-available', {
        todos: [{ content: 'Temporary task', status: 'completed' }]
      }),
      dshToolPart('dsh-todos-2', 'todo_write', 'output-available', { todos: [] })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([])
    expect(status.completedTaskCount).toBe(0)
    expect(status.totalTaskCount).toBe(0)
  })

  it('uses SDK task subject fields instead of ordinal ids', () => {
    const parts = [
      toolPart(
        'task-list',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [{ id: '1', subject: '构建瑞士风格 AI 产品发布 PPT', status: 'completed', blockedBy: [] }]
        }
      )
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([
      {
        id: '1',
        title: '构建瑞士风格 AI 产品发布 PPT',
        status: 'completed'
      }
    ])
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(1)
  })

  it('merges TaskUpdate into a pending TaskCreate by SDK ordinal id before create output arrives', () => {
    const parts = [
      toolPart('task-create', 'TaskCreate', undefined, 'input-available', {
        subject: '制作瑞士风格AI产品发布PPT',
        description: '基于瑞士国际主义风格制作发布 PPT',
        activeForm: '制作瑞士风格AI产品发布PPT'
      }),
      toolPart('task-update', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'in_progress',
        activeForm: '制作瑞士风格AI产品发布PPT'
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([
      {
        id: '1',
        title: '制作瑞士风格AI产品发布PPT',
        activeText: '制作瑞士风格AI产品发布PPT',
        status: 'in_progress'
      }
    ])
    expect(status.totalTaskCount).toBe(1)
  })

  it('keeps a session-wide TaskList scoped when loaded history starts at the current plan', () => {
    const parts = [
      toolPart(
        'create-current',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the current task' },
        'Task #11 created successfully: Start the current task'
      ),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the unloaded old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the current task', status: 'pending', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m2', parts)]

    const status = buildAgentRightPaneStatus(messages, { m2: parts })

    expect(status.tasks).toEqual([
      expect.objectContaining({ id: '11', title: 'Start the current task', status: 'pending' })
    ])
  })

  it('starts a new task plan when a later turn creates tasks after the previous plan completed', () => {
    const completedParts = [
      toolPart('create-old', 'TaskCreate', undefined, 'input-available', { subject: 'Finish the old task' }),
      toolPart('complete-old-1', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'completed'
      })
    ]
    const newParts = [
      toolPart(
        'create-new',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the new task' },
        'Task #11 created successfully: Start the new task'
      ),
      toolPart('complete-new', 'TaskUpdate', undefined, 'output-available', {
        taskId: '11',
        status: 'completed'
      }),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the new task', status: 'completed', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m1', completedParts), message('m2', newParts)]

    const status = buildAgentRightPaneStatus(messages, { m1: completedParts, m2: newParts })

    expect(status.tasks).toHaveLength(1)
    expect(status.tasks[0]).toMatchObject({ id: '11', title: 'Start the new task', status: 'completed' })
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(1)
  })

  it('starts a new task plan after the previous plan completes earlier in the same assistant message', () => {
    const oldParts = [
      toolPart(
        'create-old',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Finish the old task' },
        'Task #1 created successfully: Finish the old task'
      )
    ]
    const transitionParts = [
      toolPart('complete-old', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'completed'
      }),
      toolPart(
        'create-new',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the new task' },
        'Task #11 created successfully: Start the new task'
      ),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the new task', status: 'pending', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m1', oldParts), message('m2', transitionParts)]

    const status = buildAgentRightPaneStatus(messages, { m1: oldParts, m2: transitionParts })

    expect(status.tasks).toEqual([
      expect.objectContaining({ id: '11', title: 'Start the new task', status: 'pending' })
    ])
  })

  // SDK task events describe spawned processes, not the agent's own plan, so they populate
  // `runTasks` and stay out of the plan's done/total ratio.
  it('applies persisted Claude SDK task events to run tasks, not the plan', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'task-1',
          toolUseId: 'tool-use-1',
          status: 'in_progress',
          title: 'Inspect task state',
          activeText: 'Inspecting task state',
          taskType: 'subagent',
          subagentType: 'code-reviewer'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'progress',
          taskId: 'task-1',
          status: 'in_progress',
          title: 'Inspecting task state',
          activeText: 'Reading renderer state',
          summary: 'Reviewing renderer files',
          lastToolName: 'Read',
          usage: { totalTokens: 800, toolUses: 3, durationMs: 6000 }
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          summary: 'Inspect task state',
          outputFile: '/tmp/task-1.md',
          usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([])
    expect(status.totalTaskCount).toBe(0)
    // Fields the old shared shape could not carry now survive the projection.
    expect(status.runTasks).toEqual([
      {
        id: 'task-1',
        toolUseId: 'tool-use-1',
        title: 'Inspect task state',
        activeText: 'Reading renderer state',
        status: 'completed',
        taskType: 'subagent',
        subagentType: 'code-reviewer',
        workflowName: undefined,
        summary: 'Inspect task state',
        lastToolName: 'Read',
        outputFile: '/tmp/task-1.md',
        usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
      }
    ])
  })

  it('projects declared artifacts into status', () => {
    const parts = [
      toolPart('agent-1', 'Agent', undefined, 'input-available', { description: 'Inspect renderer state' }),
      toolPart('task-1', 'Task', undefined, 'output-error', { name: 'Audit tests' }),
      toolPart('artifacts-1', 'mcp__cherry-tools__report_artifacts', undefined, 'output-available', {
        artifacts: [
          { path: 'docs/report.md', description: 'Summary report' },
          { path: 'docs/report.md', description: 'Updated summary report' },
          { path: '/tmp/build/output.json' }
        ],
        summary: 'Created deliverables'
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.artifacts).toEqual([
      {
        toolCallId: 'artifacts-1',
        path: 'docs/report.md',
        name: 'report.md',
        description: 'Updated summary report'
      },
      {
        toolCallId: 'artifacts-1',
        path: '/tmp/build/output.json',
        name: 'output.json',
        description: undefined
      }
    ])
  })

  // The completion can land as a part (wake turn) while the late-event cache still holds an earlier
  // in-progress event; the cache applies last, so without the guard every projection rebuild —
  // e.g. a renderer refresh — resurrected the settled row.
  it('never resurrects a settled task from a stale late event', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'Fetch latest', taskType: 'local_bash' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'bg-1', status: 'completed', summary: 'done' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'bg-1': { event: 'progress', taskId: 'bg-1', status: 'in_progress', description: 'Fetch latest' }
      }
    )

    expect(status.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'completed' })])
  })

  it('keeps a stopped task terminal when liveness no longer reports it', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'Fetch latest' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'bg-1', status: 'stopped', summary: 'stopped by user' }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus(
      [message('m1', parts)],
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set() }
    )

    expect(status.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'stopped' })])
  })

  // A background task's completion arrives after its turn closed, so it never becomes a part.
  // Without merging it the row would stay running for the rest of the session.
  it('settles a run task from lifecycle that arrived after its turn closed', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'sleep 300', taskType: 'local_bash' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const running = buildAgentRightPaneStatus(messages, { m1: parts })
    expect(running.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'in_progress' })])

    const settled = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'bg-1': {
          event: 'notification',
          taskId: 'bg-1',
          status: 'completed',
          summary: 'slept',
          outputFile: '/tmp/bg-1.md'
        }
      }
    )

    // Merged by task id onto the part-derived row, keeping what only the parts knew.
    expect(settled.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        status: 'completed',
        taskType: 'local_bash',
        outputFile: '/tmp/bg-1.md'
      })
    ])
  })

  // A SendMessage resume re-points lifecycle edges at the resuming call's id, while the resumed
  // content keeps streaming under the launch id — the row's navigation anchor must stay there.
  it('keeps the launch tool-use id when a resumed run reports a new one', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'agent-1',
          status: 'in_progress',
          title: 'Review patch',
          toolUseId: 'call_launch'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'progress',
          taskId: 'agent-1',
          status: 'in_progress',
          description: 'Resumed work',
          toolUseId: 'call_resume'
        }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts })

    expect(status.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'in_progress', toolUseId: 'call_launch' })
    ])
  })

  // An interrupted turn kills its subagents without a completion event, so the persisted parts end
  // at in_progress forever. Liveness — not the events — decides whether a row still spins.
  it('stops a run task the session is no longer running', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'agent-1', status: 'in_progress', title: 'Review', taskType: 'local_agent' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'progress', taskId: 'agent-1', status: 'in_progress', description: 'Reading files' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const live = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(['m1']), liveBackgroundTaskIds: new Set() }
    )
    expect(live.runTasks).toEqual([expect.objectContaining({ id: 'agent-1', status: 'in_progress' })])

    const backgrounded = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set(['agent-1']) }
    )
    expect(backgrounded.runTasks).toEqual([expect.objectContaining({ id: 'agent-1', status: 'in_progress' })])

    const stale = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set() }
    )
    expect(stale.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending', activeText: undefined })
    ])
  })

  it('does not resurrect a historical run when an unrelated later turn starts', () => {
    const historicalParts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'agent-1',
          status: 'in_progress',
          title: 'Historical review',
          taskType: 'subagent'
        }
      }
    ] as unknown as CherryMessagePart[]
    const currentParts = [textPart('new turn')]
    const messages = [message('historical', historicalParts), message('current', currentParts)]

    const status = buildAgentRightPaneStatus(
      messages,
      { historical: historicalParts, current: currentParts },
      {},
      { activeMessageIds: new Set(['current']), liveBackgroundTaskIds: new Set() }
    )

    expect(status.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending', activeText: undefined })
    ])
  })
})
