import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RichEditorWrapper } from '../styles'

describe('RichEditorWrapper', () => {
  it('sets pre-line paragraph white-space when line break mode is enabled', () => {
    const { container } = render(<RichEditorWrapper $lineBreaks />)
    const el = container.firstChild as HTMLElement
    expect(el.style.getPropertyValue('--editor-paragraph-white-space')).toBe('pre-line')
  })

  it('leaves paragraph white-space unset by default', () => {
    const { container } = render(<RichEditorWrapper />)
    const el = container.firstChild as HTMLElement
    expect(el.style.getPropertyValue('--editor-paragraph-white-space')).toBe('')
  })
})
