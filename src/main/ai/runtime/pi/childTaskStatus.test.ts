import { describe, expect, it } from 'vitest'

import { childTaskStatus } from './childTaskStatus'

describe('childTaskStatus', () => {
  it.each(['stopped', 'aborted', 'interrupted'])('reports a %s child as stopped, not failed', (outcome) => {
    expect(childTaskStatus(outcome)).toBe('stopped')
  })

  it('reports a completed child as completed', () => {
    expect(childTaskStatus('completed')).toBe('completed')
  })

  it.each(['error', undefined])('reports a %s outcome as an error', (outcome) => {
    expect(childTaskStatus(outcome)).toBe('error')
  })
})
