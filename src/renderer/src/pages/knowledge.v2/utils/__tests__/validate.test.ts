import { describe, expect, it } from 'vitest'

import type { KnowledgeRagConfigFormValues } from '../../types'
import {
  getKnowledgeRagChunkValidationErrors,
  getKnowledgeRagConfigFormState,
  parseOptionalInteger,
  parseRequiredInteger
} from '..'

const createFormValues = (overrides: Partial<KnowledgeRagConfigFormValues> = {}): KnowledgeRagConfigFormValues => ({
  fileProcessorId: null,
  chunkSize: '512',
  chunkOverlap: '64',
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: null,
  dimensions: 1536,
  documentCount: 6,
  threshold: 0.1,
  searchMode: 'default',
  hybridAlpha: null,
  ...overrides
})

describe('parseOptionalInteger', () => {
  it('returns null for empty values', () => {
    expect(parseOptionalInteger('')).toBeNull()
  })

  it('returns an integer for valid integer strings', () => {
    expect(parseOptionalInteger('128')).toBe(128)
  })

  it('returns null for non-integer strings', () => {
    expect(parseOptionalInteger('1.5')).toBeNull()
  })
})

describe('parseRequiredInteger', () => {
  it('throws for invalid integer strings', () => {
    expect(() => parseRequiredInteger('abc')).toThrow('Expected integer string')
  })
})

describe('getKnowledgeRagChunkValidationErrors', () => {
  it('returns no errors for valid chunk values', () => {
    expect(
      getKnowledgeRagChunkValidationErrors({
        chunkSize: '512',
        chunkOverlap: '64'
      })
    ).toEqual({})
  })

  it('returns size error for non-positive chunk size', () => {
    expect(
      getKnowledgeRagChunkValidationErrors({
        chunkSize: '0',
        chunkOverlap: '64'
      })
    ).toEqual({
      chunkSize: 'chunkSizeInvalid'
    })
  })

  it('returns overlap error when overlap is not smaller than size', () => {
    expect(
      getKnowledgeRagChunkValidationErrors({
        chunkSize: '256',
        chunkOverlap: '256'
      })
    ).toEqual({
      chunkOverlap: 'chunkOverlapMustBeSmaller'
    })
  })
})

describe('knowledge rag form state helpers', () => {
  it('returns a combined form state for save gating', () => {
    expect(getKnowledgeRagConfigFormState(createFormValues(), createFormValues({ chunkOverlap: '' }))).toEqual({
      validationErrorCodes: {},
      hasEmptyChunkFields: true,
      hasValidationErrors: false,
      isDirty: true,
      canSave: false
    })
  })

  it('marks the form dirty and invalid when there are chunk validation errors', () => {
    expect(getKnowledgeRagConfigFormState(createFormValues(), createFormValues({ chunkSize: '0' }))).toEqual({
      validationErrorCodes: {
        chunkSize: 'chunkSizeInvalid'
      },
      hasEmptyChunkFields: false,
      hasValidationErrors: true,
      isDirty: true,
      canSave: false
    })
  })
})
