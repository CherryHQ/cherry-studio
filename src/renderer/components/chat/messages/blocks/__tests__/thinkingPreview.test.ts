import { describe, expect, it } from 'vitest'

import { scanThinkingPreview } from '../thinkingPreview'

describe('scanThinkingPreview', () => {
  it('continues an appended stream from the prior scan state', () => {
    const initialContent = 'First line\nVersion 3.'
    const initialResult = scanThinkingPreview(initialContent)

    expect(initialResult.preview).toBe('First line')

    const appendedResult = scanThinkingPreview(
      `${initialContent}1 is complete. Next thought is still streaming`,
      initialResult.state
    )

    expect(appendedResult.preview).toBe('Version 3.1 is complete.')
  })

  it('starts over when the content is replaced instead of appended', () => {
    const initialResult = scanThinkingPreview('First.\nStill')

    const replacementResult = scanThinkingPreview('Other?\nStill growing', initialResult.state)

    expect(replacementResult.preview).toBe('Other?')
  })

  it('completes a trailing CJK sentence ending immediately', () => {
    expect(scanThinkingPreview('还在思考。').preview).toBe('还在思考。')
  })

  it('keeps consecutive CJK sentence endings together across chunks', () => {
    const initialResult = scanThinkingPreview('真的吗？')

    const appendedResult = scanThinkingPreview('真的吗？！还要继续', initialResult.state)

    expect(appendedResult.preview).toBe('真的吗？！')
  })
})
