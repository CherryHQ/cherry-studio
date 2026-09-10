import { describe, expect, it } from 'vitest'

import { replacePromptVariables } from '../prompt'

describe('replacePromptVariables — {{assistant_name}}', () => {
  it('substitutes an assistant name containing replacement tokens literally', async () => {
    const result = await replacePromptVariables('You are {{assistant_name}}.', undefined, 'Cost $& $1 $$')
    expect(result).toBe('You are Cost $& $1 $$.')
  })

  it('leaves the placeholder untouched when the call site has no assistant', async () => {
    const result = await replacePromptVariables('You are {{assistant_name}}.')
    expect(result).toBe('You are {{assistant_name}}.')
  })
})
