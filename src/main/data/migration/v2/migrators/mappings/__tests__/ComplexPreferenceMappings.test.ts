import { describe, expect, it } from 'vitest'

import { COMPLEX_PREFERENCE_MAPPINGS, getComplexMappingById } from '../ComplexPreferenceMappings'

describe('ComplexPreferenceMappings', () => {
  describe('COMPLEX_PREFERENCE_MAPPINGS', () => {
    it('should migrate legacy onboarding completion into the provider setup status', () => {
      const onboardingMapping = COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === 'onboarding_completed_migrate')

      expect(onboardingMapping).toBeDefined()
      expect(onboardingMapping?.targetKeys).toEqual(['app.onboarding.provider_setup.status'])
      expect(onboardingMapping?.transform({ completed: 'true' })).toEqual({
        'app.onboarding.provider_setup.status': 'completed'
      })
      expect(onboardingMapping?.transform({ completed: 'false' })).toEqual({
        'app.onboarding.provider_setup.status': 'pending'
      })
      expect(onboardingMapping?.transform({ completed: undefined })).toEqual({})
    })
  })

  describe('getComplexMappingById', () => {
    it('should return undefined for non-existent id', () => {
      const mapping = getComplexMappingById('does_not_exist')
      expect(mapping).toBeUndefined()
    })
  })

  describe('openclaw_preferences', () => {
    it('should map gateway port and convert selected model JSON', () => {
      const mapping = getComplexMappingById('openclaw_preferences')!

      expect(
        mapping.transform({
          gatewayPort: 18790,
          selectedModelUniqId: '{"id":"gpt-4o","provider":"openai"}'
        })
      ).toEqual({
        'feature.openclaw.gateway_port': 18790,
        'feature.openclaw.selected_model_id': 'openai::gpt-4o'
      })
    })

    it.each([
      ['', null],
      ['null', null],
      ['"some-string"', null],
      ['[{"id":"x","provider":"y"}]', null],
      ['{"id":"openai::gpt-4","provider":"openai"}', 'openai::gpt-4'],
      ['openai::gpt-4', null]
    ])('should handle legacy selected model value %s', (selectedModelUniqId, expected) => {
      const mapping = getComplexMappingById('openclaw_preferences')!

      expect(
        mapping.transform({
          gatewayPort: 18790,
          selectedModelUniqId
        })['feature.openclaw.selected_model_id']
      ).toBe(expected)
    })

    it('should skip invalid gateway ports so schema default applies', () => {
      const mapping = getComplexMappingById('openclaw_preferences')!

      expect(mapping.transform({ gatewayPort: undefined })['feature.openclaw.gateway_port']).toBeUndefined()
      expect(mapping.transform({ gatewayPort: null })['feature.openclaw.gateway_port']).toBeUndefined()
      expect(mapping.transform({ gatewayPort: '18790' })['feature.openclaw.gateway_port']).toBeUndefined()
      expect(mapping.transform({ gatewayPort: Number.NaN })['feature.openclaw.gateway_port']).toBeUndefined()
    })
  })

  // v1 cloned this into every new assistant, so migrating it onto rows alone
  // loses the policy for assistants created after the upgrade.
  describe('default_assistant_context_count_migrate', () => {
    const transform = () =>
      COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === 'default_assistant_context_count_migrate')!.transform

    it('carries the v1 default into the global limit with the +1 offset', () => {
      expect(transform()({ contextCount: 5 })).toEqual({ 'chat.context_settings.max_messages': 6 })
      expect(transform()({ contextCount: 1 })).toEqual({ 'chat.context_settings.max_messages': 2 })
      // 0 meant "no history": v1's user-start filter left only the current user.
      expect(transform()({ contextCount: 0 })).toEqual({ 'chat.context_settings.max_messages': 1 })
    })

    it('leaves the generated default in place for unlimited or unusable values', () => {
      // 100 was v1's slider max, i.e. unlimited.
      expect(transform()({ contextCount: 100 })).toEqual({})
      expect(transform()({ contextCount: 2.5 })).toEqual({})
      expect(transform()({ contextCount: -1 })).toEqual({})
      expect(transform()({})).toEqual({})
    })
  })
})
