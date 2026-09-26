import { describe, expect, it } from 'vitest'

import { modelVisibleDenial } from '../modelVisibleDenial'

describe('modelVisibleDenial', () => {
  it('chooses markers absent from the exact user words', () => {
    const reason = '  "quoted"\n<<<USER_WORDS>>>\nlast  '
    expect(modelVisibleDenial({ approved: false, source: 'user', reason }, 'bash')).toBe(
      `The user denied permission to use bash. The tool did not execute. The user's exact words are between these markers:\n<<<<USER_WORDS>>>>\n${reason}\n<<<<USER_WORDS>>>>`
    )
  })

  it('does not attribute host status to the user', () => {
    expect(modelVisibleDenial({ approved: false, source: 'host', hostReason: 'service-shutdown' }, 'bash')).toBe(
      'service-shutdown'
    )
  })
})
