import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { popup } from '@renderer/services/popup'

import { requestComposerPrefill, useComposerPrefill } from '../useComposerPrefill'

const TOPIC_ID = 'topic-a'

function Composer({ initialText = '', topicId = TOPIC_ID }: { initialText?: string; topicId?: string }) {
  const [draft, setDraft] = useState<ComposerSerializedDraft>({ text: initialText, tokens: [] })
  const [focused, setFocused] = useState(false)
  const actionsRef = useRef({
    getDraft: () => draft,
    replaceDraft: (next: ComposerSerializedDraft) => setDraft(next),
    focus: () => setFocused(true)
  })
  actionsRef.current.getDraft = () => draft
  useComposerPrefill(actionsRef, topicId)
  return (
    <>
      <textarea aria-label="Draft" value={draft.text} readOnly />
      <output data-testid="focused">{String(focused)}</output>
    </>
  )
}

const prefill = (topicId: string, text: string) =>
  act(async () => {
    requestComposerPrefill(topicId, text)
  })

describe('useComposerPrefill', () => {
  beforeEach(() => {
    vi.mocked(popup.confirm).mockClear()
    vi.mocked(popup.confirm).mockResolvedValue(true)
  })

  it('fills an empty draft and focuses the composer without asking', async () => {
    render(<Composer />)

    await prefill(TOPIC_ID, 'Create a scheduled task for me:')

    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Create a scheduled task for me:')
    expect(screen.getByTestId('focused')).toHaveTextContent('true')
    expect(popup.confirm).not.toHaveBeenCalled()
  })

  it('replaces a non-empty draft only after the user confirms', async () => {
    render(<Composer initialText="half-written question" />)

    await prefill(TOPIC_ID, 'Remember my habits:')

    expect(popup.confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Remember my habits:')
  })

  it('keeps a non-empty draft when the user declines', async () => {
    vi.mocked(popup.confirm).mockResolvedValue(false)
    render(<Composer initialText="half-written question" />)

    await prefill(TOPIC_ID, 'Remember my habits:')

    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('half-written question')
  })

  it('treats a whitespace-only draft as empty', async () => {
    render(<Composer initialText={'  \n '} />)

    await prefill(TOPIC_ID, 'Find skills for me')

    expect(popup.confirm).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Find skills for me')
  })

  it('ignores text addressed to another conversation in the same window', async () => {
    render(<Composer initialText="" />)

    await prefill('topic-b', 'Not for this composer')

    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('')
  })
})
