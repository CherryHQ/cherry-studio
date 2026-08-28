import { describe, expect, it } from 'vitest'

import { getKnowledgeBaseFailureReason, getKnowledgeItemFailureReason } from '../error'

// Identity translator: returns the i18n key itself, so each assertion pins exactly which key the
// mapping selected without coupling to real locale copy.
const t = ((key: string) => key) as Parameters<typeof getKnowledgeBaseFailureReason>[1]

describe('getKnowledgeBaseFailureReason', () => {
  it('maps each known base error code to its localized key (exhaustive over the enum)', () => {
    expect(getKnowledgeBaseFailureReason({ error: 'missing_embedding_model' }, t)).toBe(
      'knowledge.error.missing_embedding_model'
    )
    expect(getKnowledgeBaseFailureReason({ error: 'missing_vector_store' }, t)).toBe(
      'knowledge.error.missing_vector_store'
    )
  })

  it('falls back to the generic reason when the error is null', () => {
    expect(getKnowledgeBaseFailureReason({ error: null }, t)).toBe('knowledge.error.failed_base_unknown')
  })
})

describe('getKnowledgeItemFailureReason', () => {
  it('maps a known item error code to its localized key', () => {
    expect(getKnowledgeItemFailureReason({ error: 'directory_not_migrated' }, t)).toBe(
      'knowledge.error.directory_not_migrated'
    )
  })

  it('passes a free-form item error message through unchanged', () => {
    expect(getKnowledgeItemFailureReason({ error: 'boom: something broke' }, t)).toBe('boom: something broke')
  })
})
