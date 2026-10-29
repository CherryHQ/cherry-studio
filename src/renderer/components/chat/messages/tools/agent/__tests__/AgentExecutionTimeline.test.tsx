import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { expect, it } from 'vitest'

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
    type: 'dynamic-tool', toolCallId: 'tool-Agent', toolName: 'Agent', state: 'output-available',
    input: { description: 'Inspect the workspace' }, output: { status: 'async_launched', taskId: 'task-1' }
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
