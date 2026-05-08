import { describe, expect, it } from 'vitest'

import { COMPLEX_PREFERENCE_MAPPINGS, getComplexMappingById } from '../ComplexPreferenceMappings'
import { REDUX_STORE_MAPPINGS } from '../PreferencesMappings'

describe('PreferencesMappings', () => {
  it('uses flat file processing default target keys', () => {
    expect(REDUX_STORE_MAPPINGS.preprocess).toContainEqual({
      originalKey: 'defaultProvider',
      targetKey: 'feature.file_processing.default_document_to_markdown'
    })

    expect(REDUX_STORE_MAPPINGS.ocr).toContainEqual({
      originalKey: 'imageProviderId',
      targetKey: 'feature.file_processing.default_image_to_text'
    })

    expect(REDUX_STORE_MAPPINGS.preprocess).not.toContainEqual({
      originalKey: 'defaultProvider',
      targetKey: 'feature.file_processing.default.document_to_markdown'
    })

    expect(REDUX_STORE_MAPPINGS.ocr).not.toContainEqual({
      originalKey: 'imageProviderId',
      targetKey: 'feature.file_processing.default.image_to_text'
    })
  })

  describe('llm quickAssistantId simple mapping', () => {
    it('maps quickAssistantId to feature.quick_assistant.assistant_id', () => {
      expect(REDUX_STORE_MAPPINGS.llm).toContainEqual({
        originalKey: 'quickAssistantId',
        targetKey: 'feature.quick_assistant.assistant_id'
      })
    })

    it('does not include model fields as simple mappings (handled by complex mapping)', () => {
      const llmKeys = REDUX_STORE_MAPPINGS.llm.map((m) => m.originalKey)
      expect(llmKeys).not.toContain('defaultModel.id')
      expect(llmKeys).not.toContain('topicNamingModel.id')
      expect(llmKeys).not.toContain('quickModel.id')
      expect(llmKeys).not.toContain('translateModel.id')
    })
  })

  describe('llm model IDs complex mapping', () => {
    it('registers the llm_model_ids_to_unique complex mapping', () => {
      const mapping = getComplexMappingById('llm_model_ids_to_unique')
      expect(mapping).toBeDefined()
      expect(mapping!.sources).toHaveProperty('defaultModel')
      expect(mapping!.sources).toHaveProperty('topicNamingModel')
      expect(mapping!.sources).toHaveProperty('quickModel')
      expect(mapping!.sources).toHaveProperty('translateModel')
    })

    it('targets 4 UniqueModelId preference keys', () => {
      const mapping = getComplexMappingById('llm_model_ids_to_unique')
      expect(mapping!.targetKeys).toEqual([
        'chat.default_model_id',
        'topic.naming.model_id',
        'feature.quick_assistant.model_id',
        'feature.translate.model_id'
      ])
    })

    it('does not conflict with simple mappings', () => {
      const simpleTargetKeys = Object.values(REDUX_STORE_MAPPINGS)
        .flat()
        .map((m) => m.targetKey)
      const complexTargetKeys = COMPLEX_PREFERENCE_MAPPINGS.flatMap((m) => m.targetKeys)

      const conflicts = simpleTargetKeys.filter((k) => complexTargetKeys.includes(k))
      expect(conflicts).toHaveLength(0)
    })
  })
})
