import type { Topic } from '@renderer/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BranchPane from '../BranchPane'
import type { Branch } from '../types'

// Stub BranchMessageStream so these tests stay pure structure / routing / locate.
vi.mock('../BranchMessageStream', () => ({
  default: (props: { topic: Topic }) => <div data-testid="branch-message-stream" data-topic-id={props.topic.id} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// ──────────────────────────────────────────────────────────────────────────
// SCOPE: jsdom has NO layout/scroll engine. These assert STRUCTURE (single
// region, per-branch accordion items, header+content together) and BEHAVIOUR
// (the locate scroll call fires). They do NOT prove visual position: "headers
// scroll away while content scrolls", "no overlap", "scrolled to top" are
// MANUAL-SMOKE only.
// ──────────────────────────────────────────────────────────────────────────

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

const convTopic = (id: string): Topic =>
  ({
    id: `topic-${id}`,
    assistantId: 'asst-1',
    name: id,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    messages: []
  }) as Topic

const branchA: Branch = makeBranch({ id: 'branch-A', color: 'c1' }) // compose
const branchB: Branch = makeBranch({ id: 'branch-B', color: 'c2', topic: convTopic('branch-B') }) // conversation

function renderPane(props: Partial<React.ComponentProps<typeof BranchPane>> = {}) {
  return render(
    <BranchPane
      branches={[branchA, branchB]}
      collapsedBranchIds={new Set()}
      onToggleCollapsedBranchId={vi.fn()}
      creatingBranchId={null}
      forkStatus="idle"
      onCreate={vi.fn()}
      onSendFollowUp={vi.fn()}
      onCloseBranch={vi.fn()}
      {...props}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchPane (P1-S2c-accordion)', () => {
  // ── Accordion structure: one region, no master/detail split ──────────────
  it('is ONE scroll region with NO separate master/detail regions', () => {
    renderPane()
    expect(screen.getByTestId('branch-pane-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('branch-pane-scroll').className).toContain('overflow-y-auto')
    // The old two-region layout is gone.
    expect(screen.queryByTestId('branch-pane-master')).toBeNull()
    expect(screen.queryByTestId('branch-pane-detail')).toBeNull()
  })

  it('renders one accordion item per branch, in creation order, inside the scroll region', () => {
    renderPane()
    const region = screen.getByTestId('branch-pane-scroll')
    const items = within(region).getAllByTestId(/^branch-item-branch-/)
    expect(items).toHaveLength(2)
    expect(items[0].getAttribute('data-testid')).toBe('branch-item-branch-A')
    expect(items[1].getAttribute('data-testid')).toBe('branch-item-branch-B')
  })

  it('each item contains BOTH its own header and (when expanded) its own content — never split apart', () => {
    renderPane()
    const itemA = screen.getByTestId('branch-item-branch-A')
    expect(within(itemA).getByTestId('branch-tab-branch-A')).toBeInTheDocument()
    expect(within(itemA).getByTestId('branch-detail-branch-A')).toBeInTheDocument() // expanded

    const itemB = screen.getByTestId('branch-item-branch-B')
    expect(within(itemB).getByTestId('branch-tab-branch-B')).toBeInTheDocument()
    expect(within(itemB).getByTestId('branch-detail-branch-B')).toBeInTheDocument()
  })

  it('a collapsed branch shows header only; its content is absent (but still its own item)', () => {
    renderPane({ collapsedBranchIds: new Set([branchB.id]) })
    const itemB = screen.getByTestId('branch-item-branch-B')
    expect(within(itemB).getByTestId('branch-tab-branch-B')).toBeInTheDocument()
    expect(within(itemB).queryByTestId('branch-detail-branch-B')).toBeNull()
    // A stays expanded.
    expect(within(screen.getByTestId('branch-item-branch-A')).getByTestId('branch-detail-branch-A')).toBeInTheDocument()
  })

  it('uses NO display:contents and NO position:sticky anywhere', () => {
    const { container } = renderPane()
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      expect(el.style.display).not.toBe('contents')
      expect(el.className.toString()).not.toContain('sticky')
    }
  })

  // ── locate (auto-scroll) ─────────────────────────────────────────────────
  describe('locate (scroll-to-active)', () => {
    let scrollSpy: ReturnType<typeof vi.fn>
    beforeEach(() => {
      scrollSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollSpy
    })

    it('scrolls a newly-created branch into view (and it renders expanded)', () => {
      const { rerender } = render(
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
      scrollSpy.mockClear() // ignore the mount-time reveal of branch A

      rerender(
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
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      // new branch is expanded (not collapsed) → its content rendered.
      expect(
        within(screen.getByTestId('branch-item-branch-B')).getByTestId('branch-detail-branch-B')
      ).toBeInTheDocument()
    })

    it('EXPANDING a collapsed branch (header click) toggles it AND scrolls it to top', () => {
      const onToggle = vi.fn()
      renderPane({ collapsedBranchIds: new Set([branchB.id]), onToggleCollapsedBranchId: onToggle })
      scrollSpy.mockClear()

      fireEvent.click(within(screen.getByTestId('branch-item-branch-B')).getByTestId('branch-tab-chevron'))
      expect(onToggle).toHaveBeenCalledExactlyOnceWith(branchB.id)
      expect(scrollSpy).toHaveBeenCalledTimes(1)
    })

    it('COLLAPSING an expanded branch toggles it but does NOT scroll', () => {
      const onToggle = vi.fn()
      renderPane({ collapsedBranchIds: new Set(), onToggleCollapsedBranchId: onToggle })
      scrollSpy.mockClear()

      fireEvent.click(within(screen.getByTestId('branch-item-branch-B')).getByTestId('branch-tab-chevron'))
      expect(onToggle).toHaveBeenCalledExactlyOnceWith(branchB.id)
      expect(scrollSpy).not.toHaveBeenCalled()
    })
  })

  // ── Routing (preserve S2b-2 per-branch routing) ──────────────────────────
  it('compose submit in a branch item calls onCreate(branchId, text)', () => {
    const onCreate = vi.fn()
    renderPane({ branches: [branchA], onCreate })
    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.compose_label'), { target: { value: 'q1' } })
    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(branchA.id, 'q1')
  })

  it('follow-up submit in branch B routes to B (not branches[0]); A and C untouched', () => {
    const onSendFollowUp = vi.fn()
    const a = makeBranch({ id: 'branch-A', color: 'c1', topic: convTopic('branch-A') })
    const b = makeBranch({ id: 'branch-B', color: 'c2', topic: convTopic('branch-B') })
    const c = makeBranch({ id: 'branch-C', color: 'c3', topic: convTopic('branch-C') })
    renderPane({ branches: [a, b, c], onSendFollowUp })

    const itemB = screen.getByTestId('branch-item-branch-B')
    fireEvent.change(within(itemB).getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'deepen B' }
    })
    fireEvent.click(within(itemB).getByTestId('branch-followup-send'))

    expect(onSendFollowUp).toHaveBeenCalledExactlyOnceWith(b.id, 'deepen B')
    expect(onSendFollowUp).not.toHaveBeenCalledWith(a.id, expect.anything())
    expect(onSendFollowUp).not.toHaveBeenCalledWith(c.id, expect.anything())
  })

  it('header X closes that branch (and only that one)', () => {
    const onCloseBranch = vi.fn()
    renderPane({ onCloseBranch })
    fireEvent.click(within(screen.getByTestId('branch-item-branch-A')).getByTestId('branch-tab-close'))
    expect(onCloseBranch).toHaveBeenCalledExactlyOnceWith(branchA.id)
  })

  it('forkStatus/errorMessage only reach the branch whose id === creatingBranchId', () => {
    renderPane({
      branches: [branchA, makeBranch({ id: 'branch-C', color: 'c3' })],
      creatingBranchId: branchA.id,
      forkStatus: 'error',
      forkErrorMessage: 'chat.message.anchor.panel.error.create_failed'
    })
    const itemA = screen.getByTestId('branch-item-branch-A')
    expect(within(itemA).getByTestId('branch-composer-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.create_failed'
    )
    const itemC = screen.getByTestId('branch-item-branch-C')
    expect(within(itemC).queryByTestId('branch-composer-error')).toBeNull()
  })

  // ── Visibility ───────────────────────────────────────────────────────────
  it('no branches → no resize handle and an empty scroll region', () => {
    renderPane({ branches: [] })
    expect(screen.queryByTestId('branch-pane-resize-handle')).toBeNull()
    expect(screen.getByTestId('branch-pane-scroll').children).toHaveLength(0)
  })

  it('shows the resize handle when at least one branch is open', () => {
    renderPane()
    expect(screen.getByTestId('branch-pane-resize-handle')).toBeInTheDocument()
  })
})
