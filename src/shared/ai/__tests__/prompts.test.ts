import { describe, expect, it } from 'vitest'

import { TRANSLATE_PROMPT } from '../prompts'

describe('TRANSLATE_PROMPT', () => {
  it('requires fenced Markdown and diagram syntax to survive translation', () => {
    expect(TRANSLATE_PROMPT).toContain('including Markdown syntax, code fences, code fence info strings')
    expect(TRANSLATE_PROMPT).toContain('Translate human-readable text inside diagrams')
    expect(TRANSLATE_PROMPT).not.toContain('Never write code')
  })
})
