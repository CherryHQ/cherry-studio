import type { MiniAppStatus } from '@data/db/schemas/miniapp'
import { describe, expect, it } from 'vitest'

import { transformMiniApp } from '../MiniAppMappings'

describe('MiniAppMappings', () => {
  describe('transformMiniApp', () => {
    /** A custom (non-preset) source. */
    const createCustomSource = (overrides: Record<string, unknown> = {}) => ({
      id: 'my-custom-app',
      name: 'My Custom App',
      url: 'https://custom.example.com',
      ...overrides
    })

    /** A preset (built-in) source. The id matches an entry in PRESETS_MINI_APPS. */
    const createPresetSource = (overrides: Record<string, unknown> = {}) => ({
      id: 'openai',
      name: 'ChatGPT (legacy v1 name)',
      url: 'https://chatgpt.com/',
      ...overrides
    })

    describe('custom apps (full data)', () => {
      it('should transform basic fields correctly', () => {
        const source = createCustomSource({
          logo: 'https://logo.png',
          bordered: true
        })

        const result = transformMiniApp(source, 'enabled' as MiniAppStatus)

        expect(result.appId).toBe('my-custom-app')
        expect(result.name).toBe('My Custom App')
        expect(result.url).toBe('https://custom.example.com')
        expect(result.logo).toBe('https://logo.png')
        expect(result.status).toBe('enabled')
        expect(result.bordered).toBe(true)
      })

      it('should handle bodered typo correctly', () => {
        const source = createCustomSource({ bodered: false })
        const result = transformMiniApp(source, 'enabled' as MiniAppStatus)
        expect(result.bordered).toBe(false)
      })

      it('should preserve URL logos (http/https)', () => {
        const httpLogo = transformMiniApp(
          createCustomSource({ logo: 'https://example.com/logo.png' }),
          'enabled' as MiniAppStatus
        )
        expect(httpLogo.logo).toBe('https://example.com/logo.png')
      })

      it('should preserve data URI logos', () => {
        const dataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=='
        const result = transformMiniApp(createCustomSource({ logo: dataUri }), 'enabled' as MiniAppStatus)
        expect(result.logo).toBe(dataUri)
      })

      it('should set logo to null for non-string or empty logo', () => {
        const objLogo = transformMiniApp(createCustomSource({ logo: { component: 'X' } }), 'enabled' as MiniAppStatus)
        expect(objLogo.logo).toBeNull()

        const emptyLogo = transformMiniApp(createCustomSource({ logo: '' }), 'enabled' as MiniAppStatus)
        expect(emptyLogo.logo).toBeNull()
      })

      it('should filter supportedRegions', () => {
        const valid = transformMiniApp(
          createCustomSource({ supportedRegions: ['CN', 'Global', 'Invalid'] }),
          'enabled' as MiniAppStatus
        )
        expect(valid.supportedRegions).toEqual(['CN', 'Global'])

        const empty = transformMiniApp(createCustomSource({ supportedRegions: [] }), 'enabled' as MiniAppStatus)
        expect(empty.supportedRegions).toBeNull()
      })

      it('should default bordered to true when neither field is present', () => {
        const source = createCustomSource()
        const result = transformMiniApp(source, 'enabled' as MiniAppStatus)
        expect(result.bordered).toBe(true)
      })
    })

    describe('preset apps (delta only)', () => {
      it('should drop preset fields (name, url, logo, etc.) for built-in apps', () => {
        const source = createPresetSource({
          logo: 'https://stale-old-logo.png',
          bordered: true,
          background: '#fff',
          supportedRegions: ['CN'],
          nameKey: 'minapp.openai'
        })

        const result = transformMiniApp(source, 'pinned' as MiniAppStatus)

        // Delta-only fields are populated:
        expect(result.appId).toBe('openai')
        expect(result.status).toBe('pinned')
        // Preset fields are dropped (will come from PRESETS_MINI_APPS at read time):
        expect(result.name).toBeUndefined()
        expect(result.url).toBeUndefined()
        expect(result.logo).toBeUndefined()
        expect(result.bordered).toBeUndefined()
        expect(result.background).toBeUndefined()
        expect(result.supportedRegions).toBeUndefined()
        expect(result.nameKey).toBeUndefined()
      })

      it('should handle all status values for preset apps', () => {
        const statuses: MiniAppStatus[] = ['enabled', 'disabled', 'pinned']
        for (const status of statuses) {
          const result = transformMiniApp(createPresetSource(), status)
          expect(result.status).toBe(status)
          expect(result.name).toBeUndefined()
        }
      })
    })

    it('should handle all status values for custom apps', () => {
      const statuses: MiniAppStatus[] = ['enabled', 'disabled', 'pinned']
      for (const status of statuses) {
        const result = transformMiniApp(createCustomSource(), status)
        expect(result.status).toBe(status)
      }
    })
  })
})
