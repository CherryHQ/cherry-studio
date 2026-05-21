import type { Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchPane from '../BranchPane'
import type { BranchAnchor } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const anchor: BranchAnchor = {
  messageId: 'msg-source-12345678',
  blockId: 'blk-1',
  selectedText: 'student model is a smaller distilled model'
}

const branchTopic: Topic = {
  id: 'topic-branch-abcd1234',
  assistantId: 'asst-1',
  name: 'student model is a smaller dis',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  messages: []
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchPane (T-006D-2B container + state routing)', () => {
  it('compose state: renders BranchComposer when anchor is set and branchTopic is null', () => {
    render(<BranchPane anchor={anchor} branchTopic={null} status="idle" onCreate={vi.fn()} onComposeCancel={vi.fn()} />)

    expect(screen.getByTestId('branch-composer-quote')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-pane-conversation-placeholder')).toBeNull()
  })

  it('conversation state: renders placeholder when branchTopic is set', () => {
    render(
      <BranchPane anchor={null} branchTopic={branchTopic} status="idle" onCreate={vi.fn()} onComposeCancel={vi.fn()} />
    )

    expect(screen.getByTestId('branch-pane-conversation-placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-composer-quote')).toBeNull()
  })

  it('close button is enabled in compose state and calls onComposeCancel', () => {
    const onComposeCancel = vi.fn()
    render(
      <BranchPane
        anchor={anchor}
        branchTopic={null}
        status="idle"
        onCreate={vi.fn()}
        onComposeCancel={onComposeCancel}
      />
    )

    const closeBtn = screen.getByTestId('branch-pane-close')
    expect(closeBtn).not.toBeDisabled()
    fireEvent.click(closeBtn)
    expect(onComposeCancel).toHaveBeenCalledTimes(1)
  })

  it('close button is DISABLED in conversation state (close cleanup ships in S5 — path Y)', () => {
    const onComposeCancel = vi.fn()
    render(
      <BranchPane
        anchor={null}
        branchTopic={branchTopic}
        status="idle"
        onCreate={vi.fn()}
        onComposeCancel={onComposeCancel}
      />
    )

    const closeBtn = screen.getByTestId('branch-pane-close')
    expect(closeBtn).toBeDisabled()
  })

  it('header shows source message id in compose state', () => {
    render(<BranchPane anchor={anchor} branchTopic={null} status="idle" onCreate={vi.fn()} onComposeCancel={vi.fn()} />)

    expect(screen.getByTestId('branch-pane-header')).toHaveTextContent('chat.message.anchor.panel.from_message')
  })

  it('header shows branch id in conversation state', () => {
    render(
      <BranchPane anchor={null} branchTopic={branchTopic} status="idle" onCreate={vi.fn()} onComposeCancel={vi.fn()} />
    )

    expect(screen.getByTestId('branch-pane-header')).toHaveTextContent('chat.message.anchor.panel.conversation_header')
  })

  it('forwards status + errorMessage to BranchComposer (compose state)', () => {
    render(
      <BranchPane
        anchor={anchor}
        branchTopic={null}
        status="error"
        errorMessage="chat.message.anchor.panel.error.create_failed"
        onCreate={vi.fn()}
        onComposeCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('branch-composer-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.create_failed'
    )
  })

  it('forwards onCreate to BranchComposer', () => {
    const onCreate = vi.fn()
    render(
      <BranchPane anchor={anchor} branchTopic={null} status="idle" onCreate={onCreate} onComposeCancel={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'q' }
    })
    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))

    expect(onCreate).toHaveBeenCalledWith('q')
  })
})
