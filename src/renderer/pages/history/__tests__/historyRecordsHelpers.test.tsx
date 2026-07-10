// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderAssistantEmojiIcon } from '../historyRecordsHelpers'

describe('renderAssistantEmojiIcon', () => {
  it('preserves an assistant emoji when Fluent artwork is unavailable', () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    const { container } = render(renderAssistantEmojiIcon(unsupportedEmoji))

    expect(container.querySelector('svg[data-fluent-emoji]')).not.toBeInTheDocument()
    expect(container).toHaveTextContent(unsupportedEmoji)
  })
})
