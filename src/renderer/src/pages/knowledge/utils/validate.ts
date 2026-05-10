import type { KnowledgeRagConfigFormValues } from '../types'

const knowledgeRagConfigKeys = [
  'fileProcessorId',
  'chunkSize',
  'chunkOverlap',
  'embeddingModelId',
  'dimensions',
  'rerankModelId',
  'documentCount',
  'threshold',
  'searchMode',
  'hybridAlpha'
] as const satisfies readonly (keyof KnowledgeRagConfigFormValues)[]

export type KnowledgeRagChunkValidationErrorCode =
  | 'chunkSizeInvalid'
  | 'chunkOverlapInvalid'
  | 'chunkOverlapMustBeSmaller'
export type KnowledgeRagDimensionsValidationErrorCode = 'dimensionsInvalid'

export interface KnowledgeRagChunkValidationErrors {
  chunkOverlap?: KnowledgeRagChunkValidationErrorCode
  chunkSize?: KnowledgeRagChunkValidationErrorCode
  dimensions?: KnowledgeRagDimensionsValidationErrorCode
}

export const parseOptionalInteger = (value: string) => {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export const parseRequiredInteger = (value: string) => {
  const parsed = parseOptionalInteger(value)

  if (parsed == null) {
    throw new Error(`Expected integer string, received "${value}"`)
  }

  return parsed
}

export const getKnowledgeRagChunkValidationErrors = (
  values: Pick<KnowledgeRagConfigFormValues, 'chunkOverlap' | 'chunkSize'> &
    Partial<Pick<KnowledgeRagConfigFormValues, 'dimensions'>>
): KnowledgeRagChunkValidationErrors => {
  const chunkSize = parseOptionalInteger(values.chunkSize)
  const chunkOverlap = parseOptionalInteger(values.chunkOverlap)
  const dimensions = values.dimensions == null ? null : parseOptionalInteger(values.dimensions)
  const errors: KnowledgeRagChunkValidationErrors = {}

  if (values.chunkSize && (!chunkSize || chunkSize <= 0)) {
    errors.chunkSize = 'chunkSizeInvalid'
  }

  if (values.chunkOverlap && (chunkOverlap == null || chunkOverlap < 0)) {
    errors.chunkOverlap = 'chunkOverlapInvalid'
  }

  if (chunkSize != null && chunkSize > 0 && chunkOverlap != null && chunkOverlap >= chunkSize) {
    errors.chunkOverlap = 'chunkOverlapMustBeSmaller'
  }

  if (values.dimensions && (!dimensions || dimensions <= 0)) {
    errors.dimensions = 'dimensionsInvalid'
  }

  return errors
}

export const getKnowledgeRagConfigFormState = (
  initialValues: KnowledgeRagConfigFormValues,
  currentValues: KnowledgeRagConfigFormValues
) => {
  const validationErrorCodes = getKnowledgeRagChunkValidationErrors(currentValues)
  const hasEmptyChunkFields =
    currentValues.chunkSize === '' || currentValues.chunkOverlap === '' || currentValues.dimensions === ''
  const hasValidationErrors = Object.values(validationErrorCodes).some(Boolean)
  const isDirty = knowledgeRagConfigKeys.some((key) => initialValues[key] !== currentValues[key])

  return {
    validationErrorCodes,
    hasEmptyChunkFields,
    hasValidationErrors,
    isDirty,
    canSave: isDirty && !hasEmptyChunkFields && !hasValidationErrors
  }
}
