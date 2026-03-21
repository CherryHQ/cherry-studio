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

    it('should filter out empty or non-string logos', () => {
      expect(transformMiniApp(createSource({ logo: '' }), 'enabled' as MiniAppStatus, 0).logo).toBeNull()
      expect(transformMiniApp(createSource({ logo: null }), 'enabled' as MiniAppStatus, 0).logo).toBeNull()
      expect(transformMiniApp(createSource({ logo: { src: 'x' } }), 'enabled' as MiniAppStatus, 0).logo).toBeNull()
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
