import { describe, expect, it } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import { formatKnowledgeCapacityError, getKnowledgeCapacityDetails } from '../knowledgeCapacityError'

describe('knowledgeCapacityError', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (key.endsWith('batch_too_large')) {
      return `batch ${options?.count}/${options?.limit}`
    }
    return `slots active=${options?.active} remaining=${options?.remaining} requested=${options?.requested}`
  }

  it('extracts capacity from a CAPACITY_EXCEEDED IpcError', () => {
    const capacity = { requested: 5, active: 4998, remaining: 2, limit: 5000, kind: 'no_slots' as const }
    const error = new IpcError(knowledgeErrorCodes.CAPACITY_EXCEEDED, 'english', {
      details: { fieldErrors: { base: ['x'] }, capacity }
    })

    expect(getKnowledgeCapacityDetails(error)).toEqual(capacity)
    expect(formatKnowledgeCapacityError(error, t, 'Failed')).toBe('Failed: slots active=4998 remaining=2 requested=5')
  })

  it('formats batch_too_large with count and limit', () => {
    const capacity = { requested: 5001, active: 5001, remaining: -1, limit: 5000, kind: 'batch_too_large' as const }
    const error = new IpcError(knowledgeErrorCodes.CAPACITY_EXCEEDED, 'english', {
      details: { fieldErrors: { base: ['x'] }, capacity }
    })

    expect(formatKnowledgeCapacityError(error, t, 'Failed')).toBe('Failed: batch 5001/5000')
  })

  it('returns null for non-capacity errors so callers fall back', () => {
    expect(getKnowledgeCapacityDetails(new Error('boom'))).toBeUndefined()
    expect(formatKnowledgeCapacityError(new Error('boom'), t, 'Failed')).toBeNull()
    expect(formatKnowledgeCapacityError(new IpcError('INTERNAL', 'boom'), t, 'Failed')).toBeNull()
  })
})
