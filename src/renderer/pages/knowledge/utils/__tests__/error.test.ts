import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'

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
    const diagnostic =
      'Parser error: No indexable text was extracted. Check the source, OCR, or document processing settings, then reindex.'
    expect(getKnowledgeItemFailureReason({ error: diagnostic }, t)).toBe(diagnostic)
  })

  it('localizes new and persisted legacy empty-text failures', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      fallbackLng: false,
      keySeparator: false,
      resources: {
        'en-US': { translation: enUs },
        'zh-CN': { translation: zhCn }
      }
    })
    const legacyError =
      'No indexable text was extracted. Check the source, OCR, or document processing settings, then reindex.'

    for (const [locale, expected] of [
      ['en-US', legacyError],
      ['zh-CN', '未提取到可索引的文本。请检查源内容、OCR 或文档处理设置，然后重新索引。']
    ]) {
      const translate = i18n.getFixedT(locale)
      expect(getKnowledgeItemFailureReason({ error: 'empty_indexable_text' }, translate)).toBe(expected)
      expect(getKnowledgeItemFailureReason({ error: legacyError }, translate)).toBe(expected)
    }
  })
})
