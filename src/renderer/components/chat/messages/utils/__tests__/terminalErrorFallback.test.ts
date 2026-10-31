/**
 * The fallback exists for turns whose error never produced a part. A dismissed
 * error part is not missing evidence — the user removed it from view on purpose —
 * so synthesizing a replacement would make dismissal impossible.
 */

import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import { withTerminalErrorFallback } from '../terminalErrorFallback'

const errorMessage = (id: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [],
  metadata: { status: 'error' }
})

const dismissedErrorPart = withCherryMeta(
  { type: 'data-error', data: { name: 'Error', message: 'boom' } },
  { dismissed: true }
)

describe('withTerminalErrorFallback', () => {
  it('appends a synthetic part when an error-status message has no error part', () => {
    const result = withTerminalErrorFallback([errorMessage('m1')], { m1: [] }, 'No response')

    expect(result.m1).toHaveLength(1)
    expect(result.m1?.[0]).toMatchObject({ type: 'data-error', data: { message: 'No response' } })
  })

  it('does not replace a dismissed error part with a synthetic one', () => {
    const result = withTerminalErrorFallback([errorMessage('m1')], { m1: [dismissedErrorPart] }, 'No response')

    expect(result.m1).toEqual([dismissedErrorPart])
  })

  it('keeps partial text as the answer when the error part was dismissed', () => {
    const textPart = { type: 'text', text: 'partial reply' } as CherryMessagePart
    const result = withTerminalErrorFallback(
      [errorMessage('m1')],
      { m1: [textPart, dismissedErrorPart] },
      'No response'
    )

    expect(result.m1).toEqual([textPart, dismissedErrorPart])
  })
})
