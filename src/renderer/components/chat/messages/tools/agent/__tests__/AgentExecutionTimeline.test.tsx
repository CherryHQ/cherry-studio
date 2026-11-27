import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { use } from 'react'
import { expect, it, vi } from 'vitest'

import { MessagePartsScopeProvider, PartsProvider } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { messageProjectionService } from '@renderer/services/aiTransport'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { replyParts } from '@renderer/utils/message/messagePartRows'
import type { CherryMessagePart } from '@shared/data/types/message'

import { SubagentStatusContext, SubagentStatusProvider } from '../../../blocks/SubagentStatusContext'
import { buildToolResponseFromPart } from '../../toolResponse'
import { AgentExecutionTimeline } from '../AgentExecutionTimeline'

// Catches running tool cards hiding preliminary output until the command exits.
it('shows successive Bash output while the tool is still running', async () => {
  const part: CherryMessagePart = {
    type: 'dynamic-tool',
    toolCallId: 'child-bash',
    toolName: 'bash',
    state: 'output-available',
    preliminary: true,
    input: { command: 'long-running-command' },
    output: [{ type: 'text', text: 'TOOL-FIRST' }],
    callProviderMetadata: { cherry: { transport: 'pi-agent' } }
  }
  const user = userEvent.setup()
  const { rerender } = render(
    <AgentExecutionTimeline toolResponse={buildToolResponseFromPart(part) as NormalToolResponse} />
  )
  await user.click(screen.getByRole('button', { name: /long-running-command/ }))
  expect(screen.getByText('TOOL-FIRST')).toBeVisible()
  expect(screen.queryByText('TOOL-LAST')).not.toBeInTheDocument()
  rerender(
    <AgentExecutionTimeline
      toolResponse={
        buildToolResponseFromPart({
          ...part,
          output: [{ type: 'text', text: 'TOOL-FIRST\nTOOL-LAST' }]
        }) as NormalToolResponse
      }
    />
  )
  expect(screen.getByText(/TOOL-FIRST\s+TOOL-LAST/)).toBeVisible()
})

// A steer can move a background task's terminal event into a later message.
it.each([
  ['completed', 'message.tools.completed'],
  ['error', 'message.tools.error'],
  ['stopped', 'message.tools.cancelled']
] as const)('updates the visible background task status to %s across a continuation', (status, label) => {
  const launched: CherryMessagePart = {
    type: 'data-agent-task-event',
    data: { event: 'started', taskId: 'task-1', toolUseId: 'tool-Agent', status: 'in_progress' }
  }
  const settled: CherryMessagePart = {
    type: 'data-agent-task-event',
    data: { event: 'notification', taskId: 'task-1', status }
  }
  const part: CherryMessagePart = {
    type: 'dynamic-tool',
    toolCallId: 'tool-Agent',
    toolName: 'Agent',
    state: 'output-available',
    input: { description: 'Inspect the workspace' },
    output: { status: 'async_launched', taskId: 'task-1' }
  }
  const view = (continuation: CherryMessagePart[]) => (
    <SubagentStatusProvider messageIds={['original', 'continuation']} rows={{ original: [launched], continuation }}>
      <PartsProvider value={{ original: [launched] }}>
        <MessagePartsScopeProvider messageId="original" parts={[launched]}>
          <AgentExecutionTimeline toolResponse={buildToolResponseFromPart(part) as NormalToolResponse} />
        </MessagePartsScopeProvider>
      </PartsProvider>
    </SubagentStatusProvider>
  )
  const { rerender } = render(view([]))
  expect(screen.getByText(i18next.t('message.tools.invoking'))).toBeVisible()
  rerender(view([settled]))
  expect(screen.getByText(i18next.t(label))).toBeVisible()
  expect(screen.queryByText(i18next.t('message.tools.invoking'))).not.toBeInTheDocument()
})

it('applies an addressed continuation event to the list summary without rereading historical text for 1,000 calls', async () => {
  const ipc = projectionIpc()
  const target = { kind: 'topic' as const, topicId: 'task-continuation' }
  const off = messageProjectionService.subscribe(target, () => {})
  const continuation = { id: 'continuation', role: 'assistant' as const, partIds: [], parts: [] }
  const attachment = ipc.attachments[0]
  await act(async () => attachment.resolve({ ...target, revision: 0, executions: [], messages: [continuation] }))
  let textReads = 0
  const textPart: CherryMessagePart = {
    get type() {
      textReads++
      return 'text' as const
    },
    text: 'history'
  }
  const tasks: CherryMessagePart[] = Array.from({ length: 1000 }, (_, i) => ({
    type: 'data-agent-task-event',
    data: { taskId: String(i), toolUseId: String(i), event: 'started', status: 'in_progress' }
  }))
  const rows = replyParts({ original: [textPart, ...tasks] }, [continuation])
  function Summary() {
    const lookup = use(SubagentStatusContext)
    const completed = tasks.filter((_, i) => lookup(String(i)) === 'done').length
    return <span>{completed} completed</span>
  }
  const tree = render(
    <SubagentStatusProvider messageIds={['original', 'continuation']} rows={rows} target={target}>
      <Summary />
    </SubagentStatusProvider>
  )
  try {
    expect(screen.getByText('0 completed')).toBeVisible()
    const initialReads = textReads
    expect(initialReads).toBe(1)
    act(() =>
      ipc.emit(attachment.subscriptionId, {
        kind: 'topic',
        type: 'parts',
        revision: 1,
        patches: [
          {
            type: 'part-add',
            partId: 'finish',
            placement: { messageId: continuation.id, pos: 1 },
            part: { type: 'data-agent-task-event', data: { taskId: '987', event: 'notification', status: 'completed' } }
          }
        ]
      })
    )
    expect(screen.getByText('1 completed')).toBeVisible()
    expect(textReads).toBe(initialReads)
    tree.rerender(
      <SubagentStatusProvider messageIds={['original', 'continuation']} rows={{}} target={target}>
        <Summary />
      </SubagentStatusProvider>
    )
    expect(screen.getByText('0 completed')).toBeVisible()
  } finally {
    tree.unmount()
    off()
    vi.restoreAllMocks()
  }
})
