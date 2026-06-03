import type { Topic } from '@renderer/types'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchAccordionItem from '../BranchAccordionItem'
import type { Branch } from '../types'

// ──────────────────────────────────────────────────────────────────────────
// SCOPE: these assert the REAL accordion STRUCTURE (header + content in the
// SAME per-branch item; the item is a non-shrinkable box). That is a genuine
// structural property, not a layout proxy. Visual position / scroll (headers
// scroll away, no overlap) is NOT unit-tested — jsdom has no layout engine →
// MANUAL-SMOKE.
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
    id: 'topic-B',
    assistantId: 'asst-1',
    name: 'B',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    messages: []
  } as Topic,
  color: 'c3'
}

function renderItem(branch: Branch, collapsed: boolean) {
  return render(
    <BranchAccordionItem
      branch={branch}
      index={0}
      collapsed={collapsed}
      forkStatus="idle"
      onToggleCollapse={vi.fn()}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      onSendFollowUp={vi.fn()}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchAccordionItem (P1-S2c-accordion)', () => {
  it('expanded: header AND content are descendants of the SAME per-branch item', () => {
    renderItem(conversationBranch, false)
    const item = screen.getByTestId(`branch-item-${conversationBranch.id}`)
    // The header and the content both live INSIDE this one item.
    expect(within(item).getByTestId(`branch-tab-${conversationBranch.id}`)).toBeInTheDocument()
    expect(within(item).getByTestId(`branch-detail-${conversationBranch.id}`)).toBeInTheDocument()
  })

  it('collapsed: header present, content absent (header-only)', () => {
    renderItem(conversationBranch, true)
    const item = screen.getByTestId(`branch-item-${conversationBranch.id}`)
    expect(within(item).getByTestId(`branch-tab-${conversationBranch.id}`)).toBeInTheDocument()
    expect(within(item).queryByTestId(`branch-detail-${conversationBranch.id}`)).toBeNull()
  })

  it('compose-state content = initial composer; conversation-state content = stream + follow-up composer', () => {
    const { rerender } = renderItem(composeBranch, false)
    const itemA = screen.getByTestId(`branch-item-${composeBranch.id}`)
    expect(within(itemA).getByTestId('branch-composer-quote')).toBeInTheDocument()
    expect(within(itemA).queryByTestId('branch-message-stream')).toBeNull()

    rerender(
      <BranchAccordionItem
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
    const itemB = screen.getByTestId(`branch-item-${conversationBranch.id}`)
    expect(within(itemB).queryByTestId('branch-composer-quote')).toBeNull()
    expect(within(itemB).getByTestId('branch-message-stream').getAttribute('data-topic-id')).toBe(
      conversationBranch.topic!.id
    )
    expect(within(itemB).getByTestId('branch-followup-composer')).toBeInTheDocument()
  })

  it('the item box is the non-shrinkable box (shrink-0, no min-h-0) — the overlap fix lives on the item', () => {
    renderItem(conversationBranch, false)
    const item = screen.getByTestId(`branch-item-${conversationBranch.id}`)
    expect(item.className).toContain('shrink-0')
    expect(item.className).not.toContain('min-h-0')
  })

  it('uses NO display:contents and NO position:sticky anywhere', () => {
    const { container } = renderItem(conversationBranch, false)
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      expect(el.style.display).not.toBe('contents')
      expect(el.className.toString()).not.toContain('sticky')
    }
  })
})
