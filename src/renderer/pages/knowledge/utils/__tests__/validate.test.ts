import { describe, expect, it } from 'vitest'

import type { KnowledgeRagConfigFormValues } from '@renderer/pages/knowledge/types'

import {
  getKnowledgeRagChunkValidationErrors,
  getKnowledgeRagConfigFormState,
  parseOptionalInteger,
  parseRequiredInteger
} from '../validate'

const createFormValues = (overrides: Partial<KnowledgeRagConfigFormValues> = {}): KnowledgeRagConfigFormValues => ({
  fileProcessorId: null,
  chunkSize: '512',
  chunkOverlap: '64',
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  embeddingModelId: 'openai::text-embedding-3-small',
  rerankModelId: null,
  documentCount: 6,
  threshold: 0,
  ...overrides
})

type ChunkValues = Pick<KnowledgeRagConfigFormValues, 'chunkSize' | 'chunkOverlap' | 'chunkStrategy' | 'chunkSeparator'>

const createChunkValues = (overrides: Partial<ChunkValues> = {}): ChunkValues => ({
  chunkSize: '512',
  chunkOverlap: '64',
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
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
    expect(getKnowledgeRagChunkValidationErrors(createChunkValues())).toEqual({})
  })

  it('returns size error for non-positive chunk size', () => {
    expect(getKnowledgeRagChunkValidationErrors(createChunkValues({ chunkSize: '0' }))).toEqual({
      chunkSize: 'chunkSizeInvalid'
    })
  })

  it('returns overlap error when overlap is not smaller than size', () => {
    expect(getKnowledgeRagChunkValidationErrors(createChunkValues({ chunkSize: '256', chunkOverlap: '256' }))).toEqual({
      chunkOverlap: 'chunkOverlapMustBeSmaller'
    })
  })

  it('requires a separator when smart chunking is off', () => {
    expect(
      getKnowledgeRagChunkValidationErrors(createChunkValues({ chunkStrategy: 'delimiter', chunkSeparator: '' }))
    ).toEqual({
      chunkSeparator: 'chunkSeparatorRequired'
    })
  })

  it('accepts a delimiter strategy when a separator is provided', () => {
    expect(getKnowledgeRagChunkValidationErrors(createChunkValues({ chunkStrategy: 'delimiter' }))).toEqual({})
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

  it('marks embedding model as dirty because changing it requires rebuild', () => {
    expect(
      getKnowledgeRagConfigFormState(
        createFormValues(),
        createFormValues({ embeddingModelId: 'voyage::voyage-3-large' })
      )
    ).toEqual({
      validationErrorCodes: {},
      hasEmptyChunkFields: false,
      hasValidationErrors: false,
      isDirty: true,
      canSave: true
    })
  })
})
