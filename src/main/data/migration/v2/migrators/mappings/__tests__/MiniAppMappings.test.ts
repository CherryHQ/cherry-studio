import type { MiniAppStatus } from '@data/db/schemas/miniapp'
import { describe, expect, it } from 'vitest'

import { transformMiniApp } from '../MiniAppMappings'

describe('MiniAppMappings', () => {
  describe('transformMiniApp', () => {
    const createSource = (overrides: Record<string, unknown> = {}) => ({
      id: 'test-app',
      name: 'Test App',
      url: 'https://test.com',
      ...overrides
    })

    it('should transform basic fields correctly', () => {
      const source = createSource({
        logo: 'https://logo.png',
        type: 'Default',
        bordered: true
      })

      const result = transformMiniApp(source, 'enabled' as MiniAppStatus, 0)

      expect(result.appId).toBe('test-app')
      expect(result.name).toBe('Test App')
      expect(result.url).toBe('https://test.com')
      expect(result.logo).toBe('https://logo.png')
      expect(result.type).toBe('default')
      expect(result.status).toBe('enabled')
      expect(result.sortOrder).toBe(0)
      expect(result.bordered).toBe(true)
    })

    it('should handle bodered typo correctly', () => {
      const source = createSource({ bodered: false })
      const result = transformMiniApp(source, 'enabled' as MiniAppStatus, 0)
      expect(result.bordered).toBe(false)
    })

    describe('logo handling [v2]', () => {
      it('should preserve custom app URL logos (http/https)', () => {
        const httpLogo = transformMiniApp(
          createSource({ logo: 'https://example.com/logo.png' }),
          'enabled' as MiniAppStatus,
          0
        )
        expect(httpLogo.logo).toBe('https://example.com/logo.png')

        const dataUri = transformMiniApp(
          createSource({ logo: 'data:image/png;base64,abc123' }),
          'enabled' as MiniAppStatus,
          0
        )
        expect(dataUri.logo).toBe('data:image/png;base64,abc123')
      })

      it('should preserve string key logos', () => {
        const result = transformMiniApp(createSource({ logo: 'custom-key' }), 'enabled' as MiniAppStatus, 0)
        expect(result.logo).toBe('custom-key')
      })

      it('should resolve built-in app logos from ID mapping when logo is object/invalid', () => {
        // Built-in apps should get their logo key from the mapping table
        const openai = transformMiniApp(
          { id: 'openai', name: 'ChatGPT', url: 'https://chatgpt.com', logo: { component: 'Openai' } },
          'enabled' as MiniAppStatus,
          0
        )
        expect(openai.logo).toBe('openai')

        const gemini = transformMiniApp(
          { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', logo: null },
          'enabled' as MiniAppStatus,
          0
        )
        expect(gemini.logo).toBe('gemini')

        const deepseek = transformMiniApp(
          { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', logo: '' },
          'enabled' as MiniAppStatus,
          0
        )
        expect(deepseek.logo).toBe('deepseek')
      })

      it('should fallback to application default for unknown app IDs', () => {
        const unknown = transformMiniApp(
          createSource({ id: 'unknown-app', logo: { invalid: true } }),
          'enabled' as MiniAppStatus,
          0
        )
        expect(unknown.logo).toBe('application')

        const emptyLogo = transformMiniApp(
          createSource({ id: 'my-custom-app', logo: '' }),
          'enabled' as MiniAppStatus,
          0
        )
        expect(emptyLogo.logo).toBe('application')
      })

      it('should handle all built-in app logo mappings', () => {
        const testCases = [
          { id: 'openai', expected: 'openai' },
          { id: 'moonshot', expected: 'kimi' },
          { id: 'dashscope', expected: 'qwen' },
          { id: 'anthropic', expected: 'claude' },
          { id: 'yi', expected: 'zeroone' },
          { id: 'cici', expected: 'bytedance' },
          { id: 'spark-desk', expected: 'xinghuo' },
          { id: 'grok-x', expected: 'twitter' }
        ]

        for (const { id, expected } of testCases) {
          const result = transformMiniApp(
            { id, name: 'Test', url: 'https://test.com', logo: null },
            'enabled' as MiniAppStatus,
            0
          )
          expect(result.logo).toBe(expected)
        }
      })
    })

    it('should parse addTime correctly', () => {
      const iso = transformMiniApp(createSource({ addTime: '2024-01-01T00:00:00Z' }), 'enabled' as MiniAppStatus, 0)
      expect(iso.createdAt).toBe(new Date('2024-01-01T00:00:00Z').getTime())

      const num = transformMiniApp(createSource({ addTime: 1704067200000 }), 'enabled' as MiniAppStatus, 0)
      expect(num.createdAt).toBe(1704067200000)

      const invalid = transformMiniApp(createSource({ addTime: 'invalid' }), 'enabled' as MiniAppStatus, 0)
      expect(invalid.createdAt).toBeUndefined()
    })

    it('should filter supportedRegions', () => {
      const valid = transformMiniApp(
        createSource({ supportedRegions: ['CN', 'Global', 'Invalid'] }),
        'enabled' as MiniAppStatus,
        0
      )
      expect(valid.supportedRegions).toEqual(['CN', 'Global'])

      const empty = transformMiniApp(createSource({ supportedRegions: [] }), 'enabled' as MiniAppStatus, 0)
      expect(empty.supportedRegions).toBeNull()
    })

    it('should handle all status values', () => {
      const statuses: MiniAppStatus[] = ['enabled', 'disabled', 'pinned']
      for (const status of statuses) {
        const result = transformMiniApp(createSource(), status, 5)
        expect(result.status).toBe(status)
        expect(result.sortOrder).toBe(5)
      }
    })
  })
})
