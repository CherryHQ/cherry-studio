import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { ClaudeCodeBinaryStatus } from '@shared/ai/claudeCodeBinary'

import AgentComposerSlot from '../AgentComposerSlot'

vi.mock('@renderer/components/chat/panes/Shell', () => ({ useRightPanelPresentationMaximized: () => false }))
vi.mock('../components/AgentRightPane', () => ({
  useOptionalAgentRightPaneActions: () => null
}))
vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => fallback
}))
vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: ({ sendDisabled }: { sendDisabled: boolean }) => (
    <>
      <textarea aria-label="Draft" defaultValue="My draft" />
      <button type="button" disabled={sendDisabled}>
        Send
      </button>
    </>
  ),
  MissingAgentHomeComposer: () => null
}))
let publish: (state: ClaudeCodeBinaryStatus) => void
const state = (phase: ClaudeCodeBinaryStatus['phase']): ClaudeCodeBinaryStatus => ({
  version: '0.3.284',
  phase,
  receivedBytes: 25,
  totalBytes: 100
})
const props = {
  agentId: 'agent-1',
  activeAgent: { id: 'agent-1', type: 'claude-code' } as any,
  session: { id: 'session-1' } as any,
  sessionId: 'session-1',
  isMultiSelectMode: false,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  isStreaming: false,
  sendDisabled: false,
  cancelEditing: vi.fn(),
  resendEditedMessage: vi.fn(),
  composerContext: {}
}
beforeEach(() => {
  vi.mocked(window.api.ipcApi.request)
    .mockReset()
    .mockResolvedValue({ ok: true, data: state('downloading') })
  vi.mocked(window.api.ipcApi.on).mockImplementation((_event, handler) => {
    publish = handler
    return () => {}
  })
})

it('blocks sending through preparation and download, shows progress, then restores sending without losing the draft', async () => {
  render(<AgentComposerSlot {...props} />)
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  await userEvent.type(screen.getByRole('textbox'), ' edited')
  act(() => publish(state('installing')))
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  act(() => publish(state('ready')))
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('My draft edited')
})

it('keeps failures blocked and retries explicitly; switching runtime restores its composer', async () => {
  const { rerender } = render(<AgentComposerSlot {...props} />)
  await screen.findByRole('progressbar')
  act(() => publish({ ...state('error'), error: 'network' }))
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: /retry|重试/i }))
  await screen.findByRole('progressbar')
  rerender(<AgentComposerSlot {...props} activeAgent={{ id: 'agent-2', type: 'pi' } as any} />)
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('does not overwrite a completed download with a stale ensure response', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(window.api.ipcApi.request).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  render(<AgentComposerSlot {...props} />)
  act(() => publish(state('ready')))
  await act(async () => resolve({ ok: true, data: state('downloading') }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
})
