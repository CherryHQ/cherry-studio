import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import type { AgentSessionApproval } from '@shared/ai/agentSessionApprovals'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AgentApprovalComposer, isAgentApprovalRecord } from '../AgentSessionApprovals'

const request = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request, on: vi.fn(() => () => {}) } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>
}))

const approval: AgentSessionApproval = {
  registrationId: 'registration-1',
  approvalId: 'native-approval',
  messageId: 'canonical-record',
  status: 'pending',
  taskPath: [{ contextId: 'child-context', toolCallId: 'spawn' }],
  source: { contextId: 'root-context', threadId: 'native-child' },
  part: {
    type: 'dynamic-tool',
    toolName: 'CustomTool',
    toolCallId: 'child-tool',
    state: 'approval-requested',
    input: { path: '/tmp/review.txt' },
    approval: { id: 'native-approval' }
  }
}

beforeEach(() => request.mockClear())

// Answering a child must settle the same registration in both composers and restore the parent's draft.
it('answers from the child composer and restores the parent composer after settlement', async () => {
  const user = userEvent.setup()
  const view = (pending: boolean) => (
    <>
      <section aria-label="Parent composer">
        <ConversationComposerSlot
          fallback={<textarea aria-label="Parent draft" defaultValue="Keep my draft" />}
          composerContext={{
            overrides: pending
              ? [
                  {
                    id: 'approval',
                    render: () => <AgentApprovalComposer sessionId="root" approvals={[approval]} />
                  }
                ]
              : []
          }}
        />
      </section>
      <section aria-label="Child composer">
        <AgentApprovalComposer
          sessionId="root"
          approvals={[{ ...approval, status: pending ? 'pending' : 'approved' }]}
          embedded
        />
      </section>
    </>
  )
  const { rerender } = render(view(true))
  const parent = within(screen.getByRole('region', { name: 'Parent composer' }))
  const child = within(screen.getByRole('region', { name: 'Child composer' }))
  expect(parent.queryByRole('textbox', { name: 'Parent draft' })).toBeNull()
  expect(parent.getByRole('button', { name: /agent.toolPermission.button.allow/ })).toBeVisible()
  await user.click(child.getByRole('button', { name: /agent.toolPermission.button.allow/ }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      'ai.tool.respond_approval',
      expect.objectContaining({
        topicId: 'agent-session:root',
        anchorId: 'canonical-record',
        approvalId: 'native-approval',
        registrationId: 'registration-1',
        approved: true
      })
    )
  )
  rerender(view(false))
  expect(screen.queryByRole('button', { name: /agent.toolPermission.button.allow/ })).toBeNull()
  expect(parent.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Keep my draft')
})

// A secondary composer must not approve when the parent handles a keyboard shortcut.
it('does not capture Enter from the parent in a child composer', () => {
  render(<AgentApprovalComposer sessionId="root" approvals={[approval]} embedded />)
  fireEvent.keyDown(document, { key: 'Enter', code: 'Enter' })
  expect(request).not.toHaveBeenCalled()
})

// Notification selection and a reissued native id must use the selected record's current registration.
it('selects an offscreen approval and never answers a prior registration', async () => {
  const user = userEvent.setup()
  const next = { ...approval, messageId: 'new-record', registrationId: 'registration-2' }
  const { rerender } = render(
    <AgentApprovalComposer sessionId="root" approvals={[approval, next]} selectedMessageId="new-record" />
  )
  await user.click(screen.getByRole('button', { name: /agent.toolPermission.button.deny/ }))
  expect(request).toHaveBeenCalledWith(
    'ai.tool.respond_approval',
    expect.objectContaining({ anchorId: 'new-record', registrationId: 'registration-2', approved: false })
  )
  rerender(<AgentApprovalComposer sessionId="root" approvals={[{ ...next, status: 'expired' }]} />)
  expect(screen.queryByRole('button', { name: /agent.toolPermission.button.allow/ })).toBeNull()
})

// A standalone approval is persistence, not another assistant reply; mixed native replies remain visible.
it('omits approval-only records even before task mapping or shared cache hydration', () => {
  if (approval.part.type !== 'dynamic-tool') throw new Error('Expected tool')
  const part = { ...approval.part, callProviderMetadata: { cherry: { approvalRecord: true } } }
  const record: CherryUIMessage = { id: 'canonical-record', role: 'assistant', parts: [part] }
  expect(isAgentApprovalRecord(record)).toBe(true)
  expect(
    isAgentApprovalRecord({
      ...record,
      parts: [{ ...part, callProviderMetadata: { cherry: { approvalSource: approval.source! } } }]
    })
  ).toBe(true)
  expect(isAgentApprovalRecord({ ...record, parts: [{ type: 'text', text: 'Real answer' }, part] })).toBe(false)
  expect(isAgentApprovalRecord({ ...record, parts: [approval.part] })).toBe(false)
})

// Native Claude file approvals must show the destination as well as the new contents.
it('shows the native file destination in the composer', () => {
  if (approval.part.type !== 'dynamic-tool') throw new Error('Expected tool')
  render(
    <AgentApprovalComposer
      sessionId="root"
      approvals={[
        {
          ...approval,
          part: {
            ...approval.part,
            toolName: 'Write',
            input: { file_path: '/tmp/review.txt', content: 'replacement' }
          }
        }
      ]}
    />
  )
  expect(screen.getByText('/tmp/review.txt')).toBeVisible()
  expect(screen.getByText('replacement')).toBeVisible()
})
