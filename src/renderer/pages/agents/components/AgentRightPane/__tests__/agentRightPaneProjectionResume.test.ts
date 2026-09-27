import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentToolFlowProjection, isResumeReceiptCall, resolveFlowToolCallId } from '../agentRightPaneProjection'
import { dshToolPart, message, textPart, toolPart } from './agentRightPaneProjectionTestUtils'

// A continued subagent keeps one flow: the launch opens it, each SendMessage receipt that resumed
// that agent opens a new round, and the round's prompt lands between them.
describe('agent right pane flow rounds', () => {
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

  // Workflow/local launches identify by taskId; the entry resolution must see them too.
  it('resolves a taskId-structured send-message entry back to its launch', () => {
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the workflow' },
        { status: 'async_launched', taskId: 'task-77' }
      ),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'task-77', message: 'Continue' },
        { success: true, resumedAgentId: 'task-77' }
      )
    ]
    const partsByMessageId = { m1: parts }

    expect(resolveFlowToolCallId('call_resume', partsByMessageId)).toEqual({
      toolCallId: 'call_launch',
      description: 'Launch the workflow'
    })
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

  // Short agent ids (e.g. `agent-77`) used to fail the 16-character length floor and merge every
  // continuation into the original round; the trailer names the id, so length is not a signal.
  it('splits rounds for a resumed agent with a short id', () => {
    const launchOutput = 'Async agent launched successfully.\nagentId: agent-77 (internal metadata - do not mention.)'
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch the review' }, launchOutput),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'agent-77', message: 'Continue' },
        { success: true, resumedAgentId: 'agent-77' }
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
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Continue'])
    expect(texts('call_launch:agent-flow-assistant-1')).toEqual(['Second round findings'])
  })

  // Prose that merely contains an `agentId:` token is not a launch receipt — it must not create
  // a fake continuation boundary inside an unrelated flow timeline.
  it('does not split rounds when text only mentions an agent id token', () => {
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Audit the review' },
        'The report quoted "agentId: af5051807ed7aaa30" in passing.'
      ),
      textPart('Findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'af5051807ed7aaa30', message: 'Continue' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      ),
      textPart('More findings', 'call_launch')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')
    expect(projection.messages.map((item) => item.id)).toEqual([
      'call_launch:agent-flow-prompt',
      'call_launch:agent-flow-assistant'
    ])
  })

  // The CLI's `done.`-prefixed receipt wording is used by real sessions; its launches must split
  // resumed rounds exactly like the `Async agent launched successfully.` form.
  it('splits rounds for a done-prefixed textual launch receipt', () => {
    const launchOutput = "done. agentId: agent-77 (internal metadata. Use SendMessage with to: 'agent-77')"
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch the review' }, launchOutput),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'agent-77', message: 'Continue' },
        { success: true, resumedAgentId: 'agent-77' }
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
  })

  // A continuation whose message is blank must still show the sent summary between rounds.
  it('falls back to the summary when the resume message is blank', () => {
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
        { to: 'af5051807ed7aaa30', summary: 'Finish the review', message: '   ' },
        { success: true, resumedAgentId: 'af5051807ed7aaa30' }
      ),
      textPart('Second round findings', 'call_launch')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'call_launch')
    const texts = (id: string) => projection.partsByMessageId[id].map((part) => (part as { text?: string }).text)
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Finish the review'])
  })

  // Workflow/local launches identify themselves by `taskId`; continuations for those launches
  // must split rounds exactly like agent-id launches.
  it('splits rounds for a structured taskId launch receipt', () => {
    const parts = [
      toolPart(
        'call_launch',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Launch the workflow' },
        { status: 'async_launched', taskId: 'task-77' }
      ),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'task-77', message: 'Continue' },
        { success: true, resumedAgentId: 'task-77' }
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
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Continue'])
    expect(texts('call_launch:agent-flow-assistant-1')).toEqual(['Second round findings'])
  })

  // dsh names children subagent_id and wakes them with the lowercase send_message tool; the
  // continuation splitter must treat that pair exactly like the claude SendMessage receipts.
  it('splits rounds for a dsh send_message continuation', () => {
    const parts = [
      {
        ...dshToolPart('call_launch', 'subagent', 'output-available'),
        output: { status: 'async_launched', subagent_id: 'dsh-child-1' },
        input: { description: 'DSH child' }
      } as CherryMessagePart,
      textPart('First round findings', 'call_launch'),
      dshToolPart('call_resume', 'send_message', 'output-available', {
        subagent_id: 'dsh-child-1',
        message: 'Continue'
      }),
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
    expect(texts('call_launch:agent-flow-resume-1')).toEqual(['Continue'])
  })

  // The CLI also spells the trailer 'agent_id:'; that spelling must establish the identity too.
  it('splits rounds for an agent_id-spelled textual launch receipt', () => {
    const launchOutput = 'Async agent launched successfully.\nagent_id: agent-77 (internal metadata - do not mention.)'
    const parts = [
      toolPart('call_launch', 'Agent', undefined, 'output-available', { prompt: 'Launch' }, launchOutput),
      textPart('First round findings', 'call_launch'),
      toolPart(
        'call_resume',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'agent-77', message: 'Continue' },
        { success: true, resumedAgentId: 'agent-77' }
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
  it('does not resolve a stamped receipt whose launch row is outside the window', () => {
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

    // The stamped root is absent from the window, so opening it would render an empty pane.
    expect(resolveFlowToolCallId('call_send', partsByMessageId)).toBeUndefined()
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
})

describe('isResumeReceiptCall', () => {
  // dsh parts carry the `cherry` transport, which is what lets the runtime tool names map onto
  // their canonical ones — without it `send_message` never reads as a continuation at all.
  const dshPart = (toolCallId: string, toolName: string, output: unknown, parentToolCallId?: string) =>
    ({
      type: 'dynamic-tool',
      toolCallId,
      toolName,
      state: 'output-available',
      input: { agent_id: 'dsh-child-1' },
      output,
      callProviderMetadata: {
        cherry: { transport: 'dsh-agent', ...(parentToolCallId ? { parentToolCallId } : {}) }
      }
    }) as CherryMessagePart

  const dshSendMessage = (toolCallId: string) =>
    dshPart(toolCallId, 'send_message', 'message delivered to agent dsh-child-1')

  it('treats a dsh send_message receipt with no content under it as a continuation', () => {
    const parts = [dshSendMessage('call-send')]
    expect(isResumeReceiptCall('call-send', { m1: parts })).toBe(true)
  })

  it('keeps a cold-resumed dsh send_message a root once content hangs under it', () => {
    // The child re-streams under its own send_message call, so that call is the flow's root even
    // though its result reports the agent it woke.
    const parts = [dshSendMessage('call-send'), dshPart('child', 'subagent', undefined, 'call-send')]
    expect(isResumeReceiptCall('call-send', { m1: parts })).toBe(false)
  })

  it('does not read a dsh launch receipt as a continuation', () => {
    // A launch reports a child id too; only the canonical tool name separates the two roles.
    const parts = [
      toolPart('call-launch', 'subagent', undefined, 'output-available', {}, 'started subagent dsh-child-1')
    ]
    expect(isResumeReceiptCall('call-launch', { m1: parts })).toBe(false)
  })

  it('does not redirect a call the resumed content streams under', () => {
    // A cold-resumed dsh child streams under its own send_message call, so that call is the flow's
    // root even though its receipt names a child whose launch is loaded and redirectable.
    const receipt = dshSendMessage('call-send')
    const child = dshPart('child', 'subagent', undefined, 'call-send')
    const launch = dshPart('call-launch', 'subagent', 'started subagent dsh-child-1')
    expect(resolveFlowToolCallId('call-send', { m1: [receipt, child, launch] })).toBeUndefined()
  })

  it('reads a claude-code resume receipt as a continuation', () => {
    const parts = [
      toolPart(
        'call-send',
        'SendMessage',
        undefined,
        'output-available',
        { to: 'agent-77' },
        {
          success: true,
          resumedAgentId: 'agent-77'
        }
      )
    ]
    expect(isResumeReceiptCall('call-send', { m1: parts })).toBe(true)
  })
})

