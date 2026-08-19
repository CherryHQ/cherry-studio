import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useComposerFocusRequest } from '../useComposerFocusRequest'

function Composer({ topicId }: { topicId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      EventEmitter.on(EVENT_NAMES.FOCUS_CHAT_COMPOSER, (payload) => {
        if ((payload as { topicId?: string }).topicId === topicId) inputRef.current?.focus()
      }),
    [topicId]
  )

  return <input ref={inputRef} aria-label={`Composer ${topicId}`} />
}

function Harness() {
  const [activeTopicId, setActiveTopicId] = useState('topic-1')
  const requestComposerFocus = useComposerFocusRequest(activeTopicId)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          requestComposerFocus('topic-2')
          setActiveTopicId('topic-2')
        }}>
        New conversation
      </button>
      <Composer key={activeTopicId} topicId={activeTopicId} />
    </>
  )
}

describe('useComposerFocusRequest', () => {
  it('focuses the new composer after a persistent create trigger switches conversations', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'New conversation' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Composer topic-2' })).toHaveFocus())
  })
})
