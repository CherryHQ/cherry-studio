import type { Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchDetail from '../BranchDetail'
import type { Branch } from '../types'

// ──────────────────────────────────────────────────────────────────────────
// SCOPE: the "non-shrink flex-sizing" test below is a CLASS-NAME CONTRACT
// proxy. It guards against re-introducing flex-compression (the P1-S2c
//串位/merge bug: a shrinkable, unclipped detail box gets compressed below its
// content height and spills onto the sibling box). It is NOT proof of visual
// non-overlap — jsdom has no layout engine, so actual non-overlap + the detail
// region scrolling remain MANUAL-SMOKE. A green here does NOT mean "no overlap".
// ──────────────────────────────────────────────────────────────────────────

vi.mock('../BranchMessageStream', () => ({
  default: (props: { topic: Topic }) => <div data-testid="branch-message-stream" data-topic-id={props.topic.id} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const composeBranch: Branch = {
  id: 'branch-A',
  source: {
    messageId: 'msg-1',
    blockId: 'blk-1',
    selectedText: 'student model is a smaller distilled model',
    offsets: { start: 0, end: 42 }
  },
  topic: null,
  createdAt: 1_700_000_000_000,
  color: 'c2'
}

const conversationBranch: Branch = {
  ...composeBranch,
  id: 'branch-B',
  topic: {
    id: 'topic-branch-abcd',
    assistantId: 'asst-1',
    name: 'student model',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    messages: []
  } as Topic,
  color: 'c3'
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchDetail (P1-S2c detail block)', () => {
  it('compose state (topic === null): renders the initial composer; no stream', () => {
    render(
      <BranchDetail
        branch={composeBranch}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-composer-quote')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-message-stream')).toBeNull()
    expect(screen.queryByTestId('branch-followup-composer')).toBeNull()
  })

  it('conversation state (topic !== null): renders quote + stream bound to that topic + follow-up composer', () => {
    render(
      <BranchDetail
        branch={conversationBranch}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByTestId('branch-composer-quote')).toBeNull()
    expect(screen.getByTestId('branch-detail-quote')).toBeInTheDocument()
    expect(screen.getByTestId('branch-message-stream').getAttribute('data-topic-id')).toBe(conversationBranch.topic!.id)
    expect(screen.getByTestId('branch-followup-composer')).toBeInTheDocument()
  })

  it('content container uses NO display:contents and NO position:sticky (plain flow inside the item box)', () => {
    render(
      <BranchDetail
        branch={conversationBranch}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // P1-S2c-accordion: the shrink-0 box now lives on BranchAccordionItem; this
    // is content-only (see BranchAccordionItem.test for the box contract).
    const content = screen.getByTestId(`branch-detail-${conversationBranch.id}`)
    expect(content.style.display).not.toBe('contents')
    expect(content.className).not.toContain('sticky')
  })

  it('compose Cancel routes to onClose (tab X and Cancel close the same branch)', () => {
    const onClose = vi.fn()
    render(
      <BranchDetail
        branch={composeBranch}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('conversation follow-up submit routes to onSendFollowUp', () => {
    const onSendFollowUp = vi.fn()
    render(
      <BranchDetail
        branch={conversationBranch}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={onSendFollowUp}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'next turn' }
    })
    fireEvent.click(screen.getByTestId('branch-followup-send'))
    expect(onSendFollowUp).toHaveBeenCalledExactlyOnceWith('next turn')
  })
})
