import type { Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchCard from '../BranchCard'
import { BRANCH_HL_COLOR_VALUES } from '../constants'
import type { Branch } from '../types'

vi.mock('../BranchMessageStream', () => ({
  default: (props: { topic: Topic }) => <div data-testid="branch-message-stream" data-topic-id={props.topic.id} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const composeBranch: Branch = {
  id: 'branch-A',
  source: {
    messageId: 'msg-source-12345678',
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
    id: 'topic-branch-abcd1234',
    assistantId: 'asst-1',
    name: 'student model is a smaller dis',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    messages: []
  } as Topic,
  color: 'c3'
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchCard (P1-S2b-1 single card)', () => {
  // ── Tab header ──────────────────────────────────────────────────────────
  it('renders the number badge with index+1 (creation order)', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={2}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-card-badge')).toHaveTextContent('3')
  })

  it('tab header carries data-branch-id + data-hl matching the branch (card ↔ source-highlight share the color key)', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    const tab = screen.getByTestId('branch-card-tab')
    expect(tab.getAttribute('data-branch-id')).toBe(composeBranch.id)
    expect(tab.getAttribute('data-hl')).toBe('c2')
  })

  it('tab header background is the palette rgba for this branch color (so card tint visually matches the highlight)', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    const tab = screen.getByTestId('branch-card-tab') as HTMLElement
    // jsdom normalises CSS Color Level 4 syntax `rgb(R G B / A)` into the
    // equivalent Level 3 `rgba(R, G, B, A)`. Both forms are valid; compare
    // the parsed RGBA tuple so the assertion survives that normalisation
    // but still catches drift between palette Record and what BranchCard
    // actually paints.
    const parseRgba = (s: string): [number, number, number, number] | null => {
      const m = s.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,/]+([\d.]+)\s*\)/)
      return m ? [+m[1], +m[2], +m[3], +m[4]] : null
    }
    const actual = parseRgba(tab.style.backgroundColor)
    const expected = parseRgba(BRANCH_HL_COLOR_VALUES.c2)
    expect(actual).not.toBeNull()
    expect(actual).toEqual(expected)
  })

  it('renders the selected-text snippet (truncated rendering is CSS — content is the full text)', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-card-snippet')).toHaveTextContent(composeBranch.source.selectedText)
  })

  // ── Collapse / expand ───────────────────────────────────────────────────
  it('expanded: renders body; collapsed: body absent (chevron click toggles via host)', () => {
    const onToggleCollapse = vi.fn()
    const { rerender } = render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={onToggleCollapse}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-card-body')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('branch-card-chevron'))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)

    // Simulate the host flipping collapsed=true after the toggle:
    rerender(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={true}
        forkStatus="idle"
        onToggleCollapse={onToggleCollapse}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.queryByTestId('branch-card-body')).toBeNull()
  })

  it('aria-expanded reflects the collapsed state on the chevron button', () => {
    const { rerender } = render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-card-chevron')).toHaveAttribute('aria-expanded', 'true')

    rerender(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={true}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-card-chevron')).toHaveAttribute('aria-expanded', 'false')
  })

  // ── Close ───────────────────────────────────────────────────────────────
  it('X button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={onClose}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('branch-card-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Composer Cancel also calls onClose (X and Cancel close the same branch)', () => {
    const onClose = vi.fn()
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={onClose}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ── Compose vs conversation routing ─────────────────────────────────────
  it('compose state (topic === null): renders BranchComposer; no message stream', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-composer-quote')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-message-stream')).toBeNull()
  })

  it('conversation state (topic !== null): renders quote + BranchMessageStream bound to that branch topic; no composer', () => {
    render(
      <BranchCard
        branch={conversationBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.queryByTestId('branch-composer-quote')).toBeNull()
    expect(screen.getByTestId('branch-card-quote')).toBeInTheDocument()
    const stream = screen.getByTestId('branch-message-stream')
    expect(stream.getAttribute('data-topic-id')).toBe(conversationBranch.topic!.id)
  })

  // ── Conversation-state follow-up composer (P1-S2b-2) ─────────────────────
  it('conversation state: renders the follow-up composer; compose state does NOT', () => {
    const { rerender } = render(
      <BranchCard
        branch={conversationBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-followup-composer')).toBeInTheDocument()

    rerender(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.queryByTestId('branch-followup-composer')).toBeNull()
  })

  it('forwards a follow-up submit to onSendFollowUp(text)', () => {
    const onSendFollowUp = vi.fn()
    render(
      <BranchCard
        branch={conversationBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={onSendFollowUp}
      />
    )
    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'next turn in this branch' }
    })
    fireEvent.click(screen.getByTestId('branch-followup-send'))
    expect(onSendFollowUp).toHaveBeenCalledExactlyOnceWith('next turn in this branch')
  })

  // ── Fork status forwarding ──────────────────────────────────────────────
  it('forwards forkStatus + forkErrorMessage to the composer (compose state)', () => {
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="error"
        forkErrorMessage="chat.message.anchor.panel.error.create_failed"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-composer-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.create_failed'
    )
  })

  it('forwards composer create submit to onCreate(followUp)', () => {
    const onCreate = vi.fn()
    render(
      <BranchCard
        branch={composeBranch}
        index={0}
        collapsed={false}
        forkStatus="idle"
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        onSendFollowUp={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'follow-up draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))
    expect(onCreate).toHaveBeenCalledWith('follow-up draft')
  })
})
