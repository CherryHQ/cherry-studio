import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentDelegationSnapshot } from '@shared/ai/agentSessionDelivery'

import { AgentDelegationCard } from '../AgentDelegationCard'

const navigateToRoute = vi.hoisted(() => vi.fn())
vi.mock('../../../MessageListProvider', () => ({ useOptionalMessageListActions: () => ({ navigateToRoute }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function snapshot(): AgentDelegationSnapshot {
  return {
    requestId: 'request',
    originSessionId: 'origin',
    targetSessionId: 'target',
    agentName: 'Codex',
    workspacePath: '/project',
    terminal: false,
    delivery: {
      version: 1,
      delegation: true,
      sender: { agentId: 'owner', sessionId: 'origin' },
      receiver: { agentId: 'codex', sessionId: 'target' },
      replyPolicy: 'completion',
      sourceMessageId: null,
      outcome: null,
      error: null,
      statusAt: new Date().toISOString(),
      status: 'delivering',
      inReplyTo: null,
      turnRef: 'assistant'
    },
    approvals: [{ approvalId: 'approval', toolCallId: 'tool', toolName: 'Bash', input: { command: 'pwd' } }]
  }
}
function mount() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AgentDelegationCard
        output={{ ok: true, sessionId: 'target', requestId: 'request', delivery: { sender: { sessionId: 'origin' } } }}
      />
    </SWRConfig>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('delegated task card', () => {
  it('returns a selected answer to the original delegated question', async () => {
    const current = snapshot()
    current.approvals = [
      {
        approvalId: 'question-approval',
        toolCallId: 'question-tool',
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Choose a language',
              header: 'Language',
              options: [{ label: 'TypeScript' }, { label: 'JavaScript' }],
              multiSelect: false
            }
          ]
        }
      }
    ]
    let decision: unknown
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route === 'ai.agent.delegation.respond') {
        decision = input
        current.approvals = []
        return true as never
      }
      return structuredClone(current) as never
    })
    mount()
    await userEvent.click(await screen.findByText('TypeScript'))
    expect(decision).toMatchObject({
      originSessionId: 'origin',
      requestId: 'request',
      approvalId: 'question-approval',
      approved: true,
      updatedInput: { answers: { 'Choose a language': 'TypeScript' } }
    })
    await waitFor(() => expect(screen.queryByText('Choose a language')).not.toBeInTheDocument())
  })

  it('shows the project, routes a decision to its task and keeps global Enter from granting permission', async () => {
    const current = snapshot()
    let decision: unknown
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route === 'ai.agent.delegation.respond') {
        decision = input
        current.approvals = []
        return true as never
      }
      return structuredClone(current) as never
    })
    mount()
    expect(await screen.findByText('/project')).toBeInTheDocument()
    const allow = await screen.findByRole('button', { name: 'agent.toolPermission.button.allow' })
    fireEvent.keyDown(document, { key: 'Enter', code: 'Enter' })
    expect(decision).toBeUndefined()
    await userEvent.click(allow)
    expect(decision).toMatchObject({
      originSessionId: 'origin',
      requestId: 'request',
      approvalId: 'approval',
      approved: true
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'agent.toolPermission.button.allow' })).not.toBeInTheDocument()
    )
  })

  it('refreshes terminal state after cancelling, and opens the dedicated target', async () => {
    const current = snapshot()
    current.approvals = []
    let cancelled: unknown
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route === 'ai.agent.delegation.cancel') {
        cancelled = input
        current.terminal = true
        current.delivery.status = 'consumed'
        current.delivery.outcome = 'interrupted'
        return undefined as never
      }
      return structuredClone(current) as never
    })
    mount()
    await screen.findByText('/project')
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(cancelled).toEqual({ originSessionId: 'origin', requestId: 'request' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument())
    expect(screen.getByText('message.tools.cancelled')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'message.tools.sessionCreate.open' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({ path: '/app/agents', query: { sessionId: 'target' } })
  })
})
