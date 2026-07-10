// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderAssistantEmojiIcon } from '../historyRecordsHelpers'

describe('renderAssistantEmojiIcon', () => {
  it('falls back to the default assistant emoji when the assistant emoji has no Fluent artwork', () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    const { container } = render(renderAssistantEmojiIcon(unsupportedEmoji))

    expect(container.querySelector('svg[data-fluent-emoji="😀"]')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(unsupportedEmoji)
  })
})
