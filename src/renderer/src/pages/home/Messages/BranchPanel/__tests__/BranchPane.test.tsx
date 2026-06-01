import type { Topic } from '@renderer/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchPane from '../BranchPane'
import type { Branch } from '../types'

// Stub BranchMessageStream so BranchPane tests stay pure layout / routing —
// the stream's own contract is verified in BranchMessageStream.test.tsx.
vi.mock('../BranchMessageStream', () => ({
  default: (props: { topic: Topic }) => <div data-testid="branch-message-stream" data-topic-id={props.topic.id} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function makeBranch(overrides: Partial<Branch> & Pick<Branch, 'id' | 'color'>): Branch {
  return {
    source: {
      messageId: `msg-${overrides.id}`,
      blockId: `blk-${overrides.id}`,
      selectedText: `selection-${overrides.id}`,
      offsets: { start: 0, end: 10 }
    },
    topic: null,
    createdAt: 1_700_000_000_000,
    ...overrides
  } as Branch
}

const branchA: Branch = makeBranch({ id: 'branch-A', color: 'c1' })
const branchBTopic: Topic = {
  id: 'topic-B',
  assistantId: 'asst-1',
  name: 'B branch topic',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  messages: []
} as Topic
const branchB: Branch = makeBranch({ id: 'branch-B', color: 'c2', topic: branchBTopic })

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchPane (P1-S2b-1 multi-branch card stack)', () => {
  // ── Visibility (panel open/close generalised to N branches) ─────────────
  it('omits the resize handle when branches is empty (panel hidden)', () => {
    render(
      <BranchPane
        branches={[]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    expect(screen.queryByTestId('branch-pane-resize-handle')).toBeNull()
    // Stack container still renders (motion.div is animated to width 0) but
    // contains zero cards.
    expect(screen.getByTestId('branch-pane-stack').children).toHaveLength(0)
  })

  it('renders the resize handle when branches has at least one entry', () => {
    render(
      <BranchPane
        branches={[branchA]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    expect(screen.getByTestId('branch-pane-resize-handle')).toBeInTheDocument()
  })

  // ── N-card render ───────────────────────────────────────────────────────
  it('renders one card per branch in creation order; badges 1, 2 reflect index+1', () => {
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    expect(screen.getByTestId(`branch-card-${branchA.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`branch-card-${branchB.id}`)).toBeInTheDocument()
    const cards = screen.getAllByTestId(/^branch-card-branch-/)
    expect(cards).toHaveLength(2)
    // Order = branches[] order
    expect(cards[0].getAttribute('data-testid')).toBe(`branch-card-${branchA.id}`)
    expect(cards[1].getAttribute('data-testid')).toBe(`branch-card-${branchB.id}`)
    // Badges from the cards themselves (one badge per card).
    const badges = screen.getAllByTestId('branch-card-badge')
    expect(badges[0]).toHaveTextContent('1')
    expect(badges[1]).toHaveTextContent('2')
  })

  it('each card carries its own data-branch-id + data-hl on the tab (cards do not share color)', () => {
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    const tabs = screen.getAllByTestId('branch-card-tab')
    expect(tabs[0].getAttribute('data-branch-id')).toBe(branchA.id)
    expect(tabs[0].getAttribute('data-hl')).toBe('c1')
    expect(tabs[1].getAttribute('data-branch-id')).toBe(branchB.id)
    expect(tabs[1].getAttribute('data-hl')).toBe('c2')
  })

  // ── Per-card body routing ───────────────────────────────────────────────
  it('compose-state card body has a composer; conversation-state card body has a stream bound to that branch topic', () => {
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    const cardA = screen.getByTestId(`branch-card-${branchA.id}`)
    expect(within(cardA).getByTestId('branch-composer-quote')).toBeInTheDocument()
    expect(within(cardA).queryByTestId('branch-message-stream')).toBeNull()

    const cardB = screen.getByTestId(`branch-card-${branchB.id}`)
    expect(within(cardB).queryByTestId('branch-composer-quote')).toBeNull()
    const streamB = within(cardB).getByTestId('branch-message-stream')
    expect(streamB.getAttribute('data-topic-id')).toBe(branchBTopic.id)
  })

  // ── Collapse routing ────────────────────────────────────────────────────
  it('body of a card whose id is in collapsedBranchIds is hidden; others stay expanded', () => {
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set([branchB.id])}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    const cardA = screen.getByTestId(`branch-card-${branchA.id}`)
    const cardB = screen.getByTestId(`branch-card-${branchB.id}`)
    expect(within(cardA).getByTestId('branch-card-body')).toBeInTheDocument()
    expect(within(cardB).queryByTestId('branch-card-body')).toBeNull()
  })

  it('chevron click calls onToggleCollapsedBranchId with that branch id', () => {
    const onToggle = vi.fn()
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={onToggle}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    const cardB = screen.getByTestId(`branch-card-${branchB.id}`)
    fireEvent.click(within(cardB).getByTestId('branch-card-chevron'))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(branchB.id)
  })

  // ── Close routing ───────────────────────────────────────────────────────
  it('X on a single card calls onCloseBranch with THAT branch id (not the others)', () => {
    const onCloseBranch = vi.fn()
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={onCloseBranch}
      />
    )
    const cardA = screen.getByTestId(`branch-card-${branchA.id}`)
    fireEvent.click(within(cardA).getByTestId('branch-card-close'))
    expect(onCloseBranch).toHaveBeenCalledExactlyOnceWith(branchA.id)
  })

  // ── Fork status routing (only the creating card gets non-idle status) ──
  it('forkStatus + forkErrorMessage only reach the card whose id === creatingBranchId; others see idle', () => {
    render(
      <BranchPane
        branches={[branchA, branchB]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={branchA.id}
        forkStatus="error"
        forkErrorMessage="chat.message.anchor.panel.error.create_failed"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    // A is the creating branch and in compose state → composer surfaces the error.
    const cardA = screen.getByTestId(`branch-card-${branchA.id}`)
    expect(within(cardA).getByTestId('branch-composer-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.create_failed'
    )
    // B is in conversation state (no composer at all) AND not the creating branch.
    // The composer-error testid simply doesn't exist on B's card.
    const cardB = screen.getByTestId(`branch-card-${branchB.id}`)
    expect(within(cardB).queryByTestId('branch-composer-error')).toBeNull()
  })

  // ── Create routing ──────────────────────────────────────────────────────
  it('composer submit on a compose-state card calls onCreate(branchId, followUp) — branch id namespaced per card', () => {
    const onCreate = vi.fn()
    render(
      <BranchPane
        branches={[branchA]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={onCreate}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'q1' }
    })
    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(branchA.id, 'q1')
  })

  // ── Follow-up routing (P1-S2b-2) ─────────────────────────────────────────
  // The core of this step: with N conversation-state branches, a follow-up
  // typed into card X must route to card X — never branches[0] or a global
  // "active" branch.
  const convBranch = (id: string, color: 'c1' | 'c2' | 'c3'): Branch =>
    makeBranch({
      id,
      color,
      topic: {
        id: `topic-${id}`,
        assistantId: 'asst-1',
        name: id,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        messages: []
      } as Topic
    })

  it('conversation-state cards render a follow-up composer; compose-state cards do not', () => {
    render(
      <BranchPane
        branches={[branchA /* compose */, branchB /* conversation */]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={vi.fn()}
        onCloseBranch={vi.fn()}
      />
    )
    const cardA = screen.getByTestId(`branch-card-${branchA.id}`)
    const cardB = screen.getByTestId(`branch-card-${branchB.id}`)
    expect(within(cardA).queryByTestId('branch-followup-composer')).toBeNull()
    expect(within(cardB).getByTestId('branch-followup-composer')).toBeInTheDocument()
  })

  it('a follow-up submitted in card B routes to B; A and C receive nothing (NOT branches[0])', () => {
    const onSendFollowUp = vi.fn()
    const a = convBranch('branch-A', 'c1')
    const b = convBranch('branch-B', 'c2')
    const c = convBranch('branch-C', 'c3')
    render(
      <BranchPane
        branches={[a, b, c]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={onSendFollowUp}
        onCloseBranch={vi.fn()}
      />
    )
    const cardB = screen.getByTestId(`branch-card-${b.id}`)
    fireEvent.change(within(cardB).getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'deepen B' }
    })
    fireEvent.click(within(cardB).getByTestId('branch-followup-send'))

    expect(onSendFollowUp).toHaveBeenCalledExactlyOnceWith(b.id, 'deepen B')
    // Explicitly assert it did NOT route to the first or any other branch.
    expect(onSendFollowUp).not.toHaveBeenCalledWith(a.id, expect.anything())
    expect(onSendFollowUp).not.toHaveBeenCalledWith(c.id, expect.anything())
  })

  it('a follow-up submitted in card A routes to A (first card is not special)', () => {
    const onSendFollowUp = vi.fn()
    const a = convBranch('branch-A', 'c1')
    const b = convBranch('branch-B', 'c2')
    render(
      <BranchPane
        branches={[a, b]}
        collapsedBranchIds={new Set()}
        onToggleCollapsedBranchId={vi.fn()}
        creatingBranchId={null}
        forkStatus="idle"
        onCreate={vi.fn()}
        onSendFollowUp={onSendFollowUp}
        onCloseBranch={vi.fn()}
      />
    )
    const cardA = screen.getByTestId(`branch-card-${a.id}`)
    fireEvent.change(within(cardA).getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'deepen A' }
    })
    fireEvent.click(within(cardA).getByTestId('branch-followup-send'))

    expect(onSendFollowUp).toHaveBeenCalledExactlyOnceWith(a.id, 'deepen A')
  })
})
