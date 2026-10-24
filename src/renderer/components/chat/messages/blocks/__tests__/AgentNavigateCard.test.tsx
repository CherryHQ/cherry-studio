import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildToolResponseFromPart } from '@renderer/components/chat/messages/tools/toolResponse'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import type { CherryMessagePart } from '@shared/data/types/message'

import { KeyedMessageActivityStore } from '../../hooks/useMessageActivityState'
import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import MessagePartsRenderer from '../MessagePartsRenderer'

// Keep disclosure semantics real: the global UI mock is deliberately flattened.
vi.unmock('@cherrystudio/ui')

const target = { path: '/settings/provider', query: { id: 'provider-1' } }
const metadata = { type: 'mcp', name: 'navigate', serverId: 'assistant', serverName: 'assistant' }
const navigatePart = {
  type: 'dynamic-tool',
  toolCallId: 'navigate-1',
  toolName: 'mcp__assistant__navigate',
  providerExecuted: true,
  state: 'output-available',
  input: target,
  callProviderMetadata: { cherry: { transport: 'claude-agent', tool: metadata } },
  output: { content: 'Navigate link created: /settings/provider?id=provider-1', metadata }
} as CherryMessagePart
const textPart: CherryMessagePart = { type: 'text', text: 'Click the navigation button above.' }
const ordinaryPart = (id: string): CherryMessagePart => ({
  type: 'dynamic-tool',
  toolCallId: id,
  toolName: 'mcp__other__read',
  state: 'output-available',
  input: {},
  output: 'Read complete'
})
const buttonName = '🔑 Model Provider ✓'

function setup(parts: CherryMessagePart[], live = false) {
  const navigateToRoute = vi.fn()
  const openDiagnosticReport = vi.fn()
  const activityStore = new KeyedMessageActivityStore()
  const message: MessageListItem = {
    id: 'navigate-message',
    role: 'assistant',
    assistantId: 'agent-1',
    topicId: 'session-1',
    createdAt: '2026-01-01T00:00:00Z',
    status: live ? 'pending' : 'success'
  }
  if (live) activityStore.update([message.id], [], 'streaming')
  const tree = (nextParts: CherryMessagePart[], nextMessage = message) => {
    const value: MessageListProviderValue = {
      state: {
        topic: { id: message.topicId, name: 'Navigate session' } as MessageListProviderValue['state']['topic'],
        messages: [nextMessage],
        partsByMessageId: { [message.id]: nextParts },
        messageNavigation: 'none',
        estimateSize: 400,
        overscan: 0,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 0,
        renderConfig: defaultMessageRenderConfig,
        messageActivityStore: activityStore,
        getMessageActivityState: activityStore.getSnapshot
      },
      actions: { navigateToRoute, openDiagnosticReport },
      meta: { selectionLayer: false }
    }
    return (
      <MessageListProvider value={value}>
        <MessagePartsRenderer message={nextMessage} />
      </MessageListProvider>
    )
  }
  const result = render(tree(parts))
  return { ...result, navigateToRoute, openDiagnosticReport, activityStore, message, tree }
}

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})
afterEach(() => {
  cleanup()
  invalidateCachedMessageUiStates(['navigate-message'])
})

describe('Agent navigate card', () => {
  it('exposes the successful route action without expanding completed history', async () => {
    const user = userEvent.setup()
    const { navigateToRoute } = setup([navigatePart, textPart])
    const button = await screen.findByRole('button', { name: buttonName })
    expect(screen.queryByTestId('completed-process-trigger')).not.toBeInTheDocument()
    expect(button).toBeVisible()
    expect(within(button).getByText('✓')).toBeVisible()
    await user.click(button)
    expect(navigateToRoute.mock.calls).toEqual([[target]])
  })

  it('stays visible as later tools and reasoning arrive and after completion, without duplication', async () => {
    const parts = [ordinaryPart('before'), navigatePart]
    const view = setup(parts, true)
    await waitFor(() => expect(screen.getByRole('button', { name: buttonName })).toBeVisible())
    const later: CherryMessagePart[] = [
      ...parts,
      ordinaryPart('after'),
      { type: 'reasoning', text: 'Checking the result.', state: 'done' }
    ]
    view.rerender(view.tree(later))
    expect(screen.getAllByRole('button', { name: buttonName })).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: buttonName })).toBeVisible())
    act(() => view.activityStore.update([], [], undefined))
    view.rerender(view.tree([...later, textPart], { ...view.message, status: 'success' }))
    expect(screen.getByTestId('completed-process-trigger')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('button', { name: buttonName })).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: buttonName })).toBeVisible())
  })

  it('renders a terminal successful navigate with no final prose as a direct result', async () => {
    setup([navigatePart])
    await waitFor(() => expect(screen.getByRole('button', { name: buttonName })).toBeVisible())
    expect(screen.queryByTestId('completed-process-trigger')).not.toBeInTheDocument()
  })

  it('keeps provider navigate inside history until its disclosures are expanded', async () => {
    const user = userEvent.setup()
    const providerMetadata = { type: 'provider', name: 'mcp__assistant__navigate' }
    const part = {
      ...navigatePart,
      callProviderMetadata: { cherry: { tool: providerMetadata } },
      output: { content: 'Navigate link created: /settings/provider?id=provider-1', metadata: providerMetadata }
    } as CherryMessagePart
    expect(buildToolResponseFromPart(part)?.tool.type).toBe('provider')
    const { navigateToRoute } = setup([part, textPart])
    const history = screen.getByTestId('completed-process-trigger')
    expect(history).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: buttonName })).not.toBeInTheDocument()
    await user.click(history)
    const content = screen.getByTestId('tool-history-content')
    const toolGroup = await within(content).findByRole('button', { name: /Used an extension/ })
    expect(toolGroup).toHaveAttribute('aria-expanded', 'false')
    await user.click(toolGroup)
    const button = await within(content).findByRole('button', { name: buttonName })
    expect(button).toBeVisible()
    expect(screen.getAllByRole('button', { name: buttonName })).toHaveLength(1)
    await user.click(button)
    expect(navigateToRoute.mock.calls).toEqual([[target]])
  })

  it('preserves the diagnostic report card and review action', async () => {
    const user = userEvent.setup()
    const { openDiagnosticReport } = setup([
      {
        type: 'dynamic-tool',
        toolCallId: 'diagnostic-1',
        toolName: 'mcp__assistant__prepare_diagnostic_report',
        state: 'output-available',
        input: {},
        output: { ok: true, description: 'Diagnostic draft' }
      },
      textPart
    ])
    const button = await screen.findByRole('button', { name: 'Review problem report' })
    expect(button).toBeVisible()
    await user.click(button)
    expect(openDiagnosticReport.mock.calls).toEqual([['Diagnostic draft']])
  })
})
