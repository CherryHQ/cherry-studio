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
      expect(result.kind).toBe('default')
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
          { id: 'moonshot', expected: 'Moonshot' },
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

    it('should normalize supportedRegions with only-invalid entries to null', () => {
      const result = transformMiniApp(
        createSource({ supportedRegions: ['Invalid', 'EU'] }),
        'enabled' as MiniAppStatus,
        0
      )
      expect(result.supportedRegions).toBeNull()
    })

    it('should handle non-array supportedRegions gracefully', () => {
      const stringRegion = transformMiniApp(createSource({ supportedRegions: 'CN' }), 'enabled' as MiniAppStatus, 0)
      expect(stringRegion.supportedRegions).toBeNull()

      const nullRegion = transformMiniApp(createSource({ supportedRegions: null }), 'enabled' as MiniAppStatus, 0)
      expect(nullRegion.supportedRegions).toBeNull()

      const undefinedRegion = transformMiniApp(createSource(), 'enabled' as MiniAppStatus, 0)
      expect(undefinedRegion.supportedRegions).toBeNull()
    })

    it('should prefer bordered over bodered (typo) when both exist', () => {
      const source = createSource({ bodered: false, bordered: true })
      const result = transformMiniApp(source, 'enabled' as MiniAppStatus, 0)
      // bodered ?? bordered: bodered is false (falsy), so falls through to bordered
      expect(result.bordered).toBe(true)
    })

    it('should use bodered value when bordered is absent', () => {
      const source = createSource({ bodered: false })
      const result = transformMiniApp(source, 'enabled' as MiniAppStatus, 0)
      expect(result.bordered).toBe(false)
    })

    it('should default bordered to true when neither field is present', () => {
      const source = createSource()
      const result = transformMiniApp(source, 'enabled' as MiniAppStatus, 0)
      expect(result.bordered).toBe(true)
    })

    it('should handle logo as React component ref (object)', () => {
      const result = transformMiniApp(
        {
          id: 'unknown-app',
          name: 'Unknown',
          url: 'https://unknown.com',
          logo: { $$typeof: Symbol.for('react.element') }
        },
        'enabled' as MiniAppStatus,
        0
      )
      // Non-string logo → falls back to BUILTIN_APP_LOGO_MAP or DEFAULT_LOGO_KEY
      expect(result.logo).toBe('application')
    })

    it('should preserve data URI logos for custom apps', () => {
      const dataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=='
      const result = transformMiniApp(
        createSource({ id: 'my-custom-app', logo: dataUri }),
        'enabled' as MiniAppStatus,
        0
      )
      expect(result.logo).toBe(dataUri)
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
