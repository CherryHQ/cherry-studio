// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { EmojiAvatar, EmojiIcon } from '@cherrystudio/ui'
import { EmojiAvatar as ComponentsEmojiAvatar, EmojiIcon as ComponentsEmojiIcon } from '@cherrystudio/ui/components'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('emoji compatibility exports', () => {
  it('keeps root imports available with native rendering', () => {
    const { container } = render(
      <>
        <EmojiIcon emoji="👨‍👩‍👧‍👦" />
        <EmojiAvatar>🇨🇳</EmojiAvatar>
      </>
    )

    expect(container).toHaveTextContent('👨‍👩‍👧‍👦')
    expect(container).toHaveTextContent('🇨🇳')
    expect(container.querySelector('svg[data-fluent-emoji]')).not.toBeInTheDocument()
  })

  it('keeps components imports available with native rendering', () => {
    const { container } = render(
      <>
        <ComponentsEmojiIcon emoji="👨‍👩‍👧‍👦" />
        <ComponentsEmojiAvatar>🇨🇳</ComponentsEmojiAvatar>
      </>
    )

    expect(container).toHaveTextContent('👨‍👩‍👧‍👦')
    expect(container).toHaveTextContent('🇨🇳')
    expect(container.querySelector('svg[data-fluent-emoji]')).not.toBeInTheDocument()
  })
})
