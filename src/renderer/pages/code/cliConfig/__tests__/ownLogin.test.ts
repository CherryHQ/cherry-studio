import { describe, expect, it } from 'vitest'

import {
  buildCodexOwnLoginConfig,
  buildGeminiOwnLoginSettings,
  buildKimiOwnLoginConfig,
  buildQwenOwnLoginConfig
} from '../ownLogin'

describe('ownLogin builders', () => {
  describe('buildCodexOwnLoginConfig', () => {
    it('strips the Cherry model/provider and applies only the tool params', () => {
      const existing = {
        model: 'gpt-5-codex',
        model_provider: 'cherry-openai',
        model_providers: { 'cherry-openai': { base_url: 'x' }, 'user-provider': { base_url: 'y' } },
        approval_policy: 'never',
        model_reasoning_effort: 'high',
        features: { goals: true },
        userKey: 'keep'
      }
      const result = buildCodexOwnLoginConfig(existing, { permissionMode: 'workspace', reasoningEffort: 'low' })

      // Cherry model + provider removed; the user's own provider entry survives.
      expect(result.model).toBeUndefined()
      expect(result.model_provider).toBeUndefined()
      expect(result.model_providers).toEqual({ 'user-provider': { base_url: 'y' } })
      // Tool params applied.
      expect(result.approval_policy).toBe('on-request')
      expect(result.sandbox_mode).toBe('workspace-write')
      expect(result.model_reasoning_effort).toBe('low')
      // goalMode absent → Cherry-injected features.goals dropped.
      expect(result.features).toBeUndefined()
      // Unrelated user keys preserved.
      expect(result.userKey).toBe('keep')
    })

    it('enables features.goals when goalMode is set and keeps disable_response_storage', () => {
      const result = buildCodexOwnLoginConfig({}, { goalMode: true, disableResponseStorage: true })
      expect(result.features).toEqual({ goals: true })
      expect(result.disable_response_storage).toBe(true)
    })
  })

  describe('buildGeminiOwnLoginSettings', () => {
    it('drops the model name + api-key auth and applies the writable settings', () => {
      const existing = {
        model: { name: 'gemini-2.5-pro', maxSessionTurns: 5 },
        security: { auth: { selectedType: 'gemini-api-key' } },
        general: { defaultApprovalMode: 'auto_edit', preferredEditor: 'vim' },
        userKey: 'keep'
      }
      const result = buildGeminiOwnLoginSettings(existing, { general: { defaultApprovalMode: 'plan', vimMode: true } })

      // Model + forced api-key auth removed (own login is OAuth).
      expect(result.model).toBeUndefined()
      expect(result.security).toBeUndefined()
      // Writable params applied; the non-writable managed key (preferredEditor) is stripped.
      expect(result.general).toEqual({ defaultApprovalMode: 'plan', vimMode: true })
      expect(result.userKey).toBe('keep')
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
