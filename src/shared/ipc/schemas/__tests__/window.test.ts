import { describe, expect, it } from 'vitest'

import { windowRequestSchemas } from '../window'

/**
 * Runtime validation contract for the window-control request routes (WindowManager
 * caller-window operations only). The router always `safeParse`s input, so these
 * assertions lock what each route accepts/rejects. Type-level inference (z.infer ≡
 * the read values) is covered in window.types.test.ts.
 */
describe('windowRequestSchemas', () => {
  it('declares exactly the eight migrated window-control routes', () => {
    expect(Object.keys(windowRequestSchemas).sort()).toEqual(
      [
        'window.close',
        'window.get_init_data',
        'window.is_full_screen',
        'window.is_maximized',
        'window.maximize',
        'window.minimize',
        'window.set_full_screen',
        'window.unmaximize'
      ].sort()
    )
  })

  it('the seven caller-scoped void-input routes accept undefined', () => {
    const voidRoutes = [
      'window.close',
      'window.minimize',
      'window.maximize',
      'window.unmaximize',
      'window.is_maximized',
      'window.is_full_screen',
      'window.get_init_data'
    ] as const
    for (const route of voidRoutes) {
      expect(windowRequestSchemas[route].input.safeParse(undefined).success).toBe(true)
    }
  })

  it('set_full_screen accepts a boolean and rejects non-booleans', () => {
    const schema = windowRequestSchemas['window.set_full_screen'].input
    expect(schema.safeParse(true).success).toBe(true)
    expect(schema.safeParse(false).success).toBe(true)
    expect(schema.safeParse('yes').success).toBe(false)
    expect(schema.safeParse(undefined).success).toBe(false)
  })

  it('is_maximized / is_full_screen output a boolean', () => {
    expect(windowRequestSchemas['window.is_maximized'].output.safeParse(true).success).toBe(true)
    expect(windowRequestSchemas['window.is_maximized'].output.safeParse('nope').success).toBe(false)
    expect(windowRequestSchemas['window.is_full_screen'].output.safeParse(false).success).toBe(true)
  })

  it('get_init_data output accepts arbitrary init payloads (unknown)', () => {
    const schema = windowRequestSchemas['window.get_init_data'].output
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse({ path: '/settings/provider' }).success).toBe(true)
    expect(schema.safeParse(42).success).toBe(true)
  })
})
