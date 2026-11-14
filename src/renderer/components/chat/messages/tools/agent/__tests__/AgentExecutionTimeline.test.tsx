import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DynamicToolUIPart } from 'ai'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagePartsScopeProvider, PartsProvider } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

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

describe('observed Bash elapsed time', () => {
  type ToolPartFields<State extends DynamicToolUIPart['state'] = DynamicToolUIPart['state']> =
    State extends DynamicToolUIPart['state']
      ? Omit<Extract<DynamicToolUIPart, { state: State }>, 'type' | 'toolCallId' | 'toolName' | 'input'>
      : never

  const createPart = (fields: ToolPartFields): DynamicToolUIPart => ({
    type: 'dynamic-tool',
    toolCallId: 'silent-bash',
    toolName: 'bash',
    input: { command: 'sleep 600' },
    callProviderMetadata: { cherry: { transport: 'pi-agent' } },
    ...fields
  })
  const part = createPart({ state: 'input-available' })
  const view = (toolPart: DynamicToolUIPart = part) => (
    <AgentExecutionTimeline toolResponse={buildToolResponseFromPart(toolPart) as NormalToolResponse} />
  )
  const elapsed = (seconds: number) => i18next.t('message.tools.placeholder.elapsed.seconds', { seconds })
  const advance = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('starts observation only after argument streaming and approval waiting', () => {
    const { rerender } = render(view(createPart({ state: 'input-streaming' })))
    expect(screen.queryByText(elapsed(0))).not.toBeInTheDocument()
    advance(2000)
    const approvalPart = createPart({ state: 'approval-requested', approval: { id: 'approval-bash' } })
    rerender(<PartsProvider value={{ original: [approvalPart] }}>{view(approvalPart)}</PartsProvider>)
    expect(screen.queryByText(elapsed(0))).not.toBeInTheDocument()
    expect(screen.queryByText(elapsed(2))).not.toBeInTheDocument()
    advance(2000)
    rerender(view())
    expect(screen.getByText(elapsed(0))).toBeVisible()
  })

  it('advances in the collapsed header even when the invoking command is silent', () => {
    render(view())
    const header = screen.getByRole('button', { name: /sleep 600/ })
    expect(within(header).getByText(elapsed(0))).toBeVisible()
    expect(within(header).getByText(i18next.t('message.tools.invoking'))).toBeVisible()
    advance(1000)
    expect(within(header).getByText(elapsed(1))).toBeVisible()
    advance(1000)
    expect(within(header).getByText(elapsed(2))).toBeVisible()
  })

  it('preserves elapsed time across preliminary output updates', () => {
    const { rerender } = render(view())
    advance(3000)
    rerender(view(createPart({ state: 'output-available', preliminary: true, output: 'first' })))
    expect(screen.getByText(elapsed(3))).toBeVisible()
    advance(1000)
    rerender(view(createPart({ state: 'output-available', preliminary: true, output: 'first\nlast' })))
    expect(screen.getByText(elapsed(4))).toBeVisible()
  })

  it.each(['done', 'error', 'cancelled'] as const)('removes elapsed time when the command becomes %s', (status) => {
    const { rerender } = render(view())
    advance(2000)
    expect(screen.getByText(elapsed(2))).toBeVisible()
    rerender(
      <AgentExecutionTimeline toolResponse={{ ...(buildToolResponseFromPart(part) as NormalToolResponse), status }} />
    )
    expect(screen.queryByText(elapsed(2))).not.toBeInTheDocument()
    advance(1000)
    expect(screen.queryByText(elapsed(3))).not.toBeInTheDocument()
  })

  it('gives a second call its own clock and resets when the call identity changes', () => {
    const second = { ...part, toolCallId: 'second-bash', input: { command: 'sleep 500' } }
    const { rerender } = render(view())
    advance(3000)
    rerender(
      <>
        {view()}
        {view(second)}
      </>
    )
    advance(1000)
    expect(within(screen.getByRole('button', { name: /sleep 600/ })).getByText(elapsed(4))).toBeVisible()
    expect(within(screen.getByRole('button', { name: /sleep 500/ })).getByText(elapsed(1))).toBeVisible()
    rerender(
      <>
        {view({ ...part, toolCallId: 'replacement-bash' })}
        {view(second)}
      </>
    )
    expect(within(screen.getByRole('button', { name: /sleep 600/ })).getByText(elapsed(0))).toBeVisible()
    expect(within(screen.getByRole('button', { name: /sleep 500/ })).getByText(elapsed(1))).toBeVisible()
  })

  it('restarts observation at zero after remounting the same running call', () => {
    const { unmount } = render(view())
    advance(5000)
    expect(screen.getByText(elapsed(5))).toBeVisible()
    unmount()
    advance(2000)
    render(view())
    expect(screen.getByText(elapsed(0))).toBeVisible()
    advance(1000)
    expect(screen.getByText(elapsed(1))).toBeVisible()
  })
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
    <PartsProvider value={{ original: [launched], continuation }}>
      <MessagePartsScopeProvider messageId="original" parts={[launched]}>
        <AgentExecutionTimeline toolResponse={buildToolResponseFromPart(part) as NormalToolResponse} />
      </MessagePartsScopeProvider>
    </PartsProvider>
  )
  const { rerender } = render(view([]))
  expect(screen.getByText(i18next.t('message.tools.invoking'))).toBeVisible()
  rerender(view([settled]))
  expect(screen.getByText(i18next.t(label))).toBeVisible()
  expect(screen.queryByText(i18next.t('message.tools.invoking'))).not.toBeInTheDocument()
})
