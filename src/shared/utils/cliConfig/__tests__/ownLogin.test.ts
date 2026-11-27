import { describe, expect, it } from 'vitest'

import { buildCodexOwnLoginConfig, buildKimiOwnLoginConfig, buildQwenOwnLoginConfig } from '../ownLogin'

describe('ownLogin builders', () => {
  describe('buildCodexOwnLoginConfig', () => {
    it('strips the Cherry model/provider and applies only the tool params', () => {
      const existing = {
        model: 'gpt-5-codex',
        model_context_window: 1000000,
        model_auto_compact_token_limit: 900000,
        model_provider: 'cherry-openai',
        model_providers: { 'cherry-openai': { base_url: 'x' }, 'user-provider': { base_url: 'y' } },
        approval_policy: 'never',
        model_reasoning_effort: 'high',
        features: { goals: true },
        userKey: 'keep'
      }
      const result = buildCodexOwnLoginConfig(existing, { permissionMode: 'workspace', reasoningEffort: 'low' })

      // Cherry model + provider removed; the user's own provider entry survives.
      expect(result).not.toHaveProperty('model_context_window')
      expect(result).not.toHaveProperty('model_auto_compact_token_limit')
      expect(result.model).toBeUndefined()
      expect(result.model_provider).toBeUndefined()
      expect(result.model_providers).toEqual({ 'user-provider': { base_url: 'y' } })
      // Tool params applied.
      expect(result.approval_policy).toBe('on-request')
      expect(result.sandbox_mode).toBe('workspace-write')
      expect(result.model_reasoning_effort).toBe('low')
      // Switching credentials leaves unrelated tool settings intact.
      expect(result.features).toEqual({ goals: true })
      // Unrelated user keys preserved.
      expect(result.userKey).toBe('keep')
    })

    it('enables features.goals when goalMode is set and keeps disable_response_storage', () => {
      const result = buildCodexOwnLoginConfig({}, { goalMode: true, disableResponseStorage: true })
      expect(result.features).toEqual({ goals: true })
      expect(result.disable_response_storage).toBe(true)
    })
  })
  describe('buildQwenOwnLoginConfig', () => {
    it('strips the Cherry model/env/provider entries and applies the writable settings', () => {
      const existing = {
        model: { name: 'qwen3-coder' },
        env: { CHERRY_QWEN_API_KEY: 'secret', USER_ENV: 'keep' },
        modelProviders: {
          openai: [
            { id: 'cherry', envKey: 'CHERRY_QWEN_API_KEY' },
            { id: 'user-model', envKey: 'USER_KEY' }
          ]
        },
        security: { auth: { selectedType: 'openai' } },
        tools: { approvalMode: 'yolo' },
        userKey: 'keep'
      }
      const result = buildQwenOwnLoginConfig(existing, {
        tools: { approvalMode: 'plan' },
        general: { vimMode: true }
      })

      expect(result.model).toBeUndefined()
      expect(result.env).toEqual({ USER_ENV: 'keep' })
      expect(result.modelProviders.openai).toEqual([{ id: 'user-model', envKey: 'USER_KEY' }])
      expect(result.security).toBeUndefined()
      expect(result.tools).toEqual({ approvalMode: 'plan' })
      expect(result.general).toEqual({ vimMode: true })
      expect(result.userKey).toBe('keep')
    })
  })

  describe('buildKimiOwnLoginConfig', () => {
    it('strips the Cherry provider/model tables and default_model, applies writable params', () => {
      const existing = {
        default_model: 'cherry-kimi',
        providers: { 'cherry-kimi': { api_key: 'secret' }, 'user-provider': { api_key: 'keep' } },
        models: { 'cherry-kimi': { model: 'k2' }, 'user-model': { model: 'x' } },
        default_permission_mode: 'yolo',
        thinking: { enabled: true, effort: 'high' },
        userKey: 'keep'
      }
      const result = buildKimiOwnLoginConfig(existing, { default_permission_mode: 'auto' })

      expect(result.default_model).toBeUndefined()
      expect(result.providers).toEqual({ 'user-provider': { api_key: 'keep' } })
      expect(result.models).toEqual({ 'user-model': { model: 'x' } })
      expect(result.default_permission_mode).toBe('auto')
      // thinking (managed section) cleared since the blob omits it.
      expect(result.thinking).toBeUndefined()
      expect(result.userKey).toBe('keep')
    })
  })
})
