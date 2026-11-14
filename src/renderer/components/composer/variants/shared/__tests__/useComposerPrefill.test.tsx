import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { cacheService } from '@renderer/data/CacheService'
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
    cacheService.setPersist('ui.composer.prefill_confirm_hidden', false)
  })

  // Holds the dialog open so the test can render its content, tick the box, then answer.
  const holdDialog = () => {
    let answer: (confirmed: boolean) => void = () => {}
    let content: ReactNode = null
    vi.mocked(popup.confirm).mockImplementation(
      (props) =>
        new Promise<boolean>((resolve) => {
          content = props.content
          answer = resolve
        })
    )
    return {
      tickAndAnswer: async (confirmed: boolean) => {
        const view = render(<>{content}</>)
        fireEvent.click(screen.getByRole('checkbox'))
        view.unmount()
        await act(async () => answer(confirmed))
      }
    }
  }

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
    expect(cacheService.getPersist('ui.composer.prefill_confirm_hidden')).toBe(false)
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

  it('stops asking after the user confirms with "don\'t ask again" ticked', async () => {
    const dialog = holdDialog()
    render(<Composer initialText="draft" />)

    await prefill(TOPIC_ID, 'First suggestion')
    await dialog.tickAndAnswer(true)
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('First suggestion')

    await prefill(TOPIC_ID, 'Second suggestion')

    expect(popup.confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Second suggestion')
  })

  it('keeps asking when the user cancels with "don\'t ask again" ticked', async () => {
    const dialog = holdDialog()
    render(<Composer initialText="draft" />)

    await prefill(TOPIC_ID, 'A suggestion')
    await dialog.tickAndAnswer(false)
    await prefill(TOPIC_ID, 'Another suggestion')

    expect(popup.confirm).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('draft')
  })
})
