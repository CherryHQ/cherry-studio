import { describe, expect, it } from 'vitest'

import { createClearContextPart, hasClearContextPart } from '@shared/data/types/uiParts'

import { createDismissedNoResponsePart, hasDismissedNoResponsePart } from '../dismissedNoResponse'

describe('dismissed no-response marker', () => {
  it('keeps dismissal markers and context boundaries on separate part types', () => {
    const dismissed = createDismissedNoResponsePart()

    expect(dismissed).toEqual({ type: 'data-no-response-dismissed', data: {} })
    expect(hasDismissedNoResponsePart([dismissed])).toBe(true)
    // A context boundary is never a dismissal marker and vice versa: the
    // dismissal must not ride the data-clear type or it stops truncating history.
    expect(hasDismissedNoResponsePart([createClearContextPart()])).toBe(false)
    expect(hasClearContextPart([dismissed])).toBe(false)
  })
})
